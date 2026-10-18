"""DeepSpace realtime sync (owner: M2; wired by M4): WebSocket push of live events.

`/api/ws` - authenticated subscribers receive only events for their assigned sites.
The browser sends its Auth0 access token as the first WebSocket message, rather
than placing a credential in the URL.
{event_id, type, site_id, occurred_at, simulated, data} (live_events.json), pushed as
{"server_time": ..., "event": {...}}. On connect the client gets
{"server_time", "events": [...recent 20...]} to bootstrap offline caches.

Feed: the workers write backend/workers/data/live/events.json; a background thread tails it
(mtime + event id tail) and fans out over the running asyncio loop. Cross-process by design -
the API process never starts or ends a stop-work, it only broadcasts what the engine decided.
"""
import asyncio
import threading
import time
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.auth.dependencies import AuthenticatedUser, TokenValidationError, authenticate_access_token
from cypress_workers.common import EVENTS_FILE, now_iso, read_events

router = APIRouter(tags=["realtime"])
REPLAY = 20


class Hub:
    def __init__(self) -> None:
        self.clients: list[tuple[WebSocket, AuthenticatedUser]] = []
        self.lock = threading.Lock()
        self.loop: asyncio.AbstractEventLoop | None = None  # pinned by on_startup

    async def connect(self, ws: WebSocket, user: AuthenticatedUser) -> None:
        await ws.send_json({"server_time": now_iso(), "events": [
            event for event in read_events(REPLAY) if user.can_access_site(event["site_id"])
        ]})
        with self.lock:
            self.clients.append((ws, user))

    def drop(self, ws: WebSocket) -> None:
        with self.lock:
            self.clients = [(client, user) for client, user in self.clients if client is not ws]

    async def push(self, event: dict) -> None:
        message = {"server_time": now_iso(), "event": event}
        with self.lock:
            targets = list(self.clients)
        for ws, user in targets:
            if not user.can_access_site(event["site_id"]):
                continue
            try:
                await ws.send_json(message)
            except Exception:
                self.drop(ws)

    def push_from_thread(self, event: dict) -> None:
        """Safe entry point for the watcher thread."""
        if self.loop:
            self.loop.call_soon_threadsafe(asyncio.ensure_future, self.push(event))


HUB = Hub()


@router.websocket("/api/ws")
async def ws_events(ws: WebSocket):
    await ws.accept()
    try:
        first_message = await asyncio.wait_for(ws.receive_json(), timeout=10)
        token = first_message.get("access_token") if isinstance(first_message, dict) else None
        if not isinstance(token, str) or not token:
            raise TokenValidationError("Bearer access token required.")
        user = authenticate_access_token(token)
    except WebSocketDisconnect:
        return
    except (TokenValidationError, asyncio.TimeoutError, ValueError):
        try:
            await ws.close(code=4401)
        except WebSocketDisconnect:
            pass
        return
    await HUB.connect(ws, user)
    try:
        while True:
            await ws.receive_text()  # client pings; the server pushes asynchronously
    except WebSocketDisconnect:
        HUB.drop(ws)


def start_watcher() -> None:
    """FastAPI lifespan hook. Tails events.json and routes new events onto the loop."""
    HUB.loop = asyncio.get_running_loop()
    seen: set[str] = {e["event_id"] for e in read_events()}

    def watch() -> None:
        path = Path(EVENTS_FILE)
        stamp: tuple[float, int] = (0.0, 0)
        while True:
            try:
                if path.exists():
                    stat = path.stat()
                    now = (stat.st_mtime, stat.st_size)
                    if now != stamp:
                        stamp = now
                        fresh = [e for e in read_events() if e["event_id"] not in seen]
                        for e in fresh:
                            seen.add(e["event_id"])
                            HUB.push_from_thread(e)
            except Exception as e:  # a bad tick from a worker must not kill the hub
                print(f"[ws] watcher: {e}")
            time.sleep(1.0)

    threading.Thread(target=watch, daemon=True, name="events-watcher").start()
