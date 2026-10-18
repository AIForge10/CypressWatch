"""Shared state files, site data and small helpers used by the workers, engines and API.

The whole backend (M4) talks over JSON files under backend/workers/data/live/:
  weather_latest.json, scores_latest.json, lightning_latest.json  - ingest snapshots
  stop_work.json        - alert state; ONLY engines/lightning.py writes this
  events.json           - append-only live event log (contract live_events.json shape)
  strikes_queue.json    - demo strikes (API simulate router -> engine)
  alert_actions.json    - acks/overrides pending (API -> engine)
  ledger_anchors.json   - on-chain Merkle anchors + per-record proofs
"""
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

WORKERS_DIR = Path(__file__).resolve().parents[1]
BACKEND_DIR = WORKERS_DIR.parent
BACKEND = BACKEND_DIR  # alias used across the workers
REPO_ROOT = BACKEND_DIR.parent
LIVE = WORKERS_DIR / "data" / "live"

WEATHER_FILE = LIVE / "weather_latest.json"
SCORES_FILE = LIVE / "scores_latest.json"
LIGHTNING_FILE = LIVE / "lightning_latest.json"
STOP_WORK_FILE = LIVE / "stop_work.json"
EVENTS_FILE = LIVE / "events.json"
STRIKES_QUEUE_FILE = LIVE / "strikes_queue.json"
ALERT_ACTIONS_FILE = LIVE / "alert_actions.json"
LEDGER_ANCHORS_FILE = LIVE / "ledger_anchors.json"
SITES_FILE = BACKEND / "data" / "sites" / "sites.json"

STOP_WORK_MILES = 10.0
STOP_WORK_SECONDS = 30 * 60  # rule: all-clear 30 minutes after the most recent strike

load_dotenv(WORKERS_DIR / ".env")


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def iso_now() -> datetime:
    return datetime.now(timezone.utc)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    os.replace(tmp, path)


def load_sites() -> dict[str, dict]:
    data = read_json(SITES_FILE, {"sites": []})
    items = data["sites"] if isinstance(data, dict) else data
    return {s["site_id"]: s for s in items}


def haversine_miles(lat1, lon1, lat2, lon2) -> float:
    from math import asin, cos, radians, sin, sqrt
    lat1, lon1, lat2, lon2 = radians(lat1), radians(lon1), radians(lat2), radians(lon2)
    a = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lon2 - lon1) / 2) ** 2
    return 3958.8 * 2 * asin(min(1.0, sqrt(a)))


def make_event(type_: str, site_id: str, data: dict, simulated: bool = False) -> dict:
    """Envelope shape used by DeepSpace (see contracts/README.md + live_events.json)."""
    return {"event_id": new_id("evt"), "type": type_, "site_id": site_id,
            "occurred_at": now_iso(), "simulated": simulated, "data": data}


def append_events(events: list[dict]) -> None:
    if not events:
        return
    log = read_json(EVENTS_FILE, {"events": []})
    log["server_time"] = now_iso()
    log["events"] = (log.get("events", []) + events)[-2000:]
    write_json(EVENTS_FILE, log)


def read_events(limit: int | None = None) -> list[dict]:
    log = read_json(EVENTS_FILE, {"events": []})
    return log.get("events", [])[-limit:] if limit else log.get("events", [])
