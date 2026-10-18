"""Site beacon bridge: the beacon follows the LIVE stop-work engine, not ML scores.

Default mode (a stop-work authority cannot be a probability): the bridge listens for
stop-work events for one site and mirrors what the engine decided:
    backend/workers/data/live/events.json  (engine's decision log)
    backend/workers/data/live/stop_work.json (authoritative state, used for resync)
    each stop_work_started / stop_work_extended for the site -> `STRIKE <remaining>`
    all_clear (30-min rule expiry) or manual override        -> `ALLCLEAR`

The ML score stays available as a distinctly secondary signal (--ml-score): it only raises
the LCD hazard readout on all-clear, and never authorizes a stop-work by itself.

Usage (from the repo root):
    pip install -r hardware/site-beacon/bridge/requirements.txt
    python hardware/site-beacon/bridge/bridge.py --site site_6043 --port COM5          # live (default)
    python hardware/site-beacon/bridge/bridge.py --site site_6043 --ml-score           # secondary signal mode
Without a serial port attached, add --no-device to just print what would be sent.

Against the deployed backend (the engine runs on the server, not this laptop):
    python hardware/site-beacon/bridge/bridge.py --site site_6043 --port auto \
        --server https://64-177-55-82.sslip.io --key <BEACON_KEY>
"""
import argparse
import datetime
import json
import sys
import time
import urllib.request
from pathlib import Path

BRIDGE_DIR = Path(__file__).resolve().parent
REPO_ROOT = BRIDGE_DIR.parents[2]
LIVE = REPO_ROOT / "backend" / "workers" / "data" / "live"
DEFAULT_SCORES = LIVE / "scores_latest.json"
STOP_WORK_FILE = LIVE / "stop_work.json"
EVENTS_FILE = LIVE / "events.json"

DECISION_EVENTS = {
    "stop_work_started": "STRIKE",
    "stop_work_extended": "STRIKE",
    "all_clear": "ALLCLEAR",
    "override": "ALLCLEAR",
}


def latest_score(scores_file: Path, site_id: str):
    """Return (score, scored_at) for the site's local today, or (None, None)."""
    data = json.loads(scores_file.read_text())
    for rec in data.get("scores", []):
        if rec["site_id"] == site_id and rec.get("day_offset", 1) == 0:
            return rec["hazard_score"], data.get("scored_at")
    return None, data.get("scored_at")


def active_stop_remaining(state_file: Path, site_id: str):
    """Seconds left on the site's active stop-work, or None when it is not active."""
    data = json.loads(state_file.read_text())
    # flood_risk warnings are active too but carry no stop-work countdown; several stop-works can be open,
    # and the crew must wait for the one that ends last.
    ends = [a["stop_work_until"] for a in data.get("alerts", [])
            if a["site_id"] == site_id and a.get("status") == "active"
            and a.get("type", "stop_work_lightning") == "stop_work_lightning" and a.get("stop_work_until")]
    if not ends:
        return None
    until = datetime.datetime.fromisoformat(max(ends).replace("Z", "+00:00"))
    return max(0, int((until - datetime.datetime.now(datetime.timezone.utc)).total_seconds()))


def server_stop_remaining(server: str, key: str, site_id: str):
    """Same as active_stop_remaining, but from the deployed API (GET /api/alerts/beacon/{site_id})."""
    req = urllib.request.Request(f"{server.rstrip('/')}/api/alerts/beacon/{site_id}",
                                 headers={"X-Beacon-Key": key, "User-Agent": "cypresswatch-beacon/1.0"})
    with urllib.request.urlopen(req, timeout=8) as res:
        state = json.loads(res.read())
    if not state.get("active"):
        return None, None
    until = datetime.datetime.fromisoformat(state["stop_work_until"].replace("Z", "+00:00"))
    now = datetime.datetime.fromisoformat(state["server_time"].replace("Z", "+00:00"))  # server clock, no skew
    return max(0, int((until - now).total_seconds())), state["stop_work_until"]


def run_server_mode(args, send) -> None:
    """Follow the deployed engine over HTTPS; a network blip keeps the last state instead of clearing it."""
    print(f"following {args.site} on {args.server}", file=sys.stderr)
    was_active, last_sent, last_until = False, 0.0, None
    while True:
        try:
            remaining, until = server_stop_remaining(args.server, args.key, args.site)
        except urllib.error.HTTPError as exc:
            print(f"warning: server answered {exc.code} (check --key / BEACON_KEY)", file=sys.stderr)
            time.sleep(max(args.interval, 5)); continue
        except (OSError, ValueError, KeyError) as exc:
            print(f"warning: server unreachable ({exc}); keeping last state", file=sys.stderr)
            time.sleep(max(args.interval, 5)); continue
        active = remaining is not None and remaining > 0
        # New stop-work, a new strike that moved the end time (countdown resets at once), or a minute refresh.
        if active and (not was_active or until != last_until or time.time() - last_sent > 60):
            send(f"STRIKE {max(remaining, 60)}"); last_sent = time.time()
        elif not active and was_active:
            send("ALLCLEAR")
        was_active, last_until = active, (until if active else None)
        time.sleep(args.interval)


def run_live_mode(args, send) -> None:
    """Listen for the engine's stop-work decisions for one site; resync from state every beat."""
    if not STOP_WORK_FILE.exists() and not EVENTS_FILE.exists():
        print("warning: no engine state yet (workers not running?); sitting idle", file=sys.stderr)
    was_active = False
    seen: set[str] = set()
    try:
        seen = {e["event_id"] for e in json.loads(EVENTS_FILE.read_text()).get("events", [])
                if isinstance(e, dict) and e.get("site_id") == args.site
                and DECISION_EVENTS.get(e.get("type"))}
    except (OSError, json.JSONDecodeError):
        seen = set()
    while True:
        remaining = None
        try:
            remaining = active_stop_remaining(STOP_WORK_FILE, args.site)
        except FileNotFoundError:
            print("warning: stop_work.json not written yet (engine not running?)", file=sys.stderr)
        except (json.JSONDecodeError, KeyError, ValueError) as exc:
            print(f"warning: stop_work.json unreadable ({exc})", file=sys.stderr)
        active = remaining is not None and remaining > 0

        for event in _new_events(args.site, seen):  # fresh decisions react within ~1 s
            cmd = DECISION_EVENTS.get(event["type"])
            if not cmd:
                continue
            if cmd == "STRIKE" and not active:
                continue  # extended a stop-work that just ended; the state resync below decides
            if cmd == "STRIKE":
                send(f"STRIKE {max(remaining or 0, 60)}")
            else:
                send("ALLCLEAR")

        if active and not was_active:  # missed the event (bridge restart): state resync
            send(f"STRIKE {max(remaining, 60)}")
        elif not active and was_active:
            send("ALLCLEAR")
        was_active = active
        time.sleep(args.interval)


def _new_events(site_id: str, seen: set[str]) -> list[dict]:
    """Events for the site we have not reacted to yet (marked consumed by last_event_id cursor)."""
    try:
        events = json.loads(EVENTS_FILE.read_text()).get("events", [])
    except (OSError, json.JSONDecodeError):
        return []
    fresh = [e for e in events
             if isinstance(e, dict) and e.get("site_id") == site_id
             and e.get("event_id") and e["event_id"] not in seen
             and DECISION_EVENTS.get(e.get("type"))]
    for e in fresh:
        seen.add(e["event_id"])
    return fresh


def run_ml_mode(args, send) -> None:
    scores_file = Path(args.scores)
    if not scores_file.exists():
        print(f"error: {scores_file} not found. Run backend/ml/src/cypress_ml/score.py first.", file=sys.stderr)
        return
    sent = ""
    while True:
        try:
            score, scored_at = latest_score(scores_file, args.site)
        except json.JSONDecodeError as exc:
            print(f"warning: could not parse scores file ({exc}); retrying", file=sys.stderr)
            score, scored_at = None, None
        if score is None:
            print(f"warning: no score for {args.site} yet (scored_at={scored_at})", file=sys.stderr)
        else:
            val = str(int(round(score)))
            if val != sent:
                sent = val
                send(f"HAZARD {val}")
        time.sleep(args.interval)


BOARD_HINTS = ("usbmodem", "usbserial", "ttyACM", "ttyUSB", "wchusbserial", "Arduino", "CH340")


def resolve_port(requested: str):
    """Use the requested port if it exists, else fall back to the one attached board.

    Lets the same command work across machines (COM7 on Windows, /dev/cu.usbmodem* on macOS).
    """
    from serial.tools import list_ports
    ports = list(list_ports.comports())
    if requested == "auto" or requested not in {p.device for p in ports}:
        boards = [p for p in ports
                  if any(h.lower() in f"{p.device} {p.description}".lower() for h in BOARD_HINTS)]
        if len(boards) == 1:
            if requested != "auto":
                print(f"note: {requested} not found; using {boards[0].device} ({boards[0].description})",
                      file=sys.stderr)
            return boards[0].device
        print(f"error: serial port {requested!r} not found. Available ports:", file=sys.stderr)
        for p in ports:
            print(f"  {p.device}  ({p.description})", file=sys.stderr)
        return None
    return requested


def main() -> int:
    ap = argparse.ArgumentParser(description="Feed live stop-work decisions (or the ML readout) to the beacon.")
    ap.add_argument("--site", required=True, help="site_id, e.g. site_6043")
    ap.add_argument("--ml-score", action="store_true",
                    help="secondary mode: LCD shows the ML hazard score; it NEVER authorizes a stop-work")
    ap.add_argument("--port", default=None, help="COM5, /dev/cu.usbmodem*, /dev/ttyUSB0, or 'auto' (omit with --no-device)")
    ap.add_argument("--baud", type=int, default=9600)
    ap.add_argument("--interval", type=float, default=1.0, help="state poll interval in seconds (live mode)")
    ap.add_argument("--trigger", type=float, default=8.0, help="[ml mode] score that narrows the readout tone")
    ap.add_argument("--no-device", action="store_true", help="dry run: print commands instead of writing serial")
    ap.add_argument("--server", default=None, help="deployed API, e.g. https://64-177-55-82.sslip.io (reads its engine)")
    ap.add_argument("--key", default=None, help="BEACON_KEY configured on the server (with --server)")
    args = ap.parse_args()
    if args.server and not args.key:
        ap.error("--key is required with --server")

    if not args.no_device and not args.port:
        ap.error("--port is required unless --no-device is given")

    device = None
    if not args.no_device:
        import serial
        port = resolve_port(args.port)
        if port is None:
            return 1
        device = serial.Serial(port, args.baud, timeout=2)
        time.sleep(2.0)  # Uno boards reset when the port opens

    def send(cmd: str) -> None:
        print(f"-> {cmd}", flush=True)
        if device:
            device.write((cmd + "\n").encode("ascii"))
            device.flush()

    try:
        if args.ml_score:
            run_ml_mode(args, send)
        elif args.server:
            run_server_mode(args, send)
        else:
            run_live_mode(args, send)
    except KeyboardInterrupt:
        return 0
    finally:
        if device:
            device.close()


if __name__ == "__main__":
    raise SystemExit(main())
