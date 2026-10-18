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
"""
import argparse
import datetime
import json
import sys
import time
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
    for alert in data.get("alerts", []):
        if alert["site_id"] == site_id and alert.get("status") == "active":
            until = datetime.datetime.fromisoformat(alert["stop_work_until"].replace("Z", "+00:00"))
            return max(0, int((until - datetime.datetime.now(datetime.timezone.utc)).total_seconds()))
    return None


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


def main() -> int:
    ap = argparse.ArgumentParser(description="Feed live stop-work decisions (or the ML readout) to the beacon.")
    ap.add_argument("--site", required=True, help="site_id, e.g. site_6043")
    ap.add_argument("--ml-score", action="store_true",
                    help="secondary mode: LCD shows the ML hazard score; it NEVER authorizes a stop-work")
    ap.add_argument("--port", default=None, help="COM5, /dev/ttyUSB0, ... (omit with --no-device)")
    ap.add_argument("--baud", type=int, default=9600)
    ap.add_argument("--interval", type=float, default=1.0, help="state poll interval in seconds (live mode)")
    ap.add_argument("--trigger", type=float, default=8.0, help="[ml mode] score that narrows the readout tone")
    ap.add_argument("--no-device", action="store_true", help="dry run: print commands instead of writing serial")
    args = ap.parse_args()

    if not args.no_device and not args.port:
        ap.error("--port is required unless --no-device is given")

    device = None
    if not args.no_device:
        import serial
        device = serial.Serial(args.port, args.baud, timeout=2)
        time.sleep(2.0)  # Uno boards reset when the port opens

    def send(cmd: str) -> None:
        print(f"-> {cmd}", flush=True)
        if device:
            device.write((cmd + "\n").encode("ascii"))
            device.flush()

    try:
        if args.ml_score:
            run_ml_mode(args, send)
        else:
            run_live_mode(args, send)
    except KeyboardInterrupt:
        return 0
    finally:
        if device:
            device.close()


if __name__ == "__main__":
    raise SystemExit(main())
