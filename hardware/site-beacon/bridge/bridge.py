"""Site beacon bridge: ML service and live alert state both drive the Arduino beacon.

Two modes:
  1. --site : polls the ML hazard scores (written by backend/ml/src/cypress_ml/score.py)
       HAZARD n        show the model hazard score (0-10) on the LCD while all-clear
       STRIKE sec      start/reset the 30-minute stop-work countdown (score >= trigger)
  2. --watch-state : follows the live stop-work engine state
       (backend/workers/data/live/stop_work.json, written by
       backend/workers/cypress_workers/engines/lightning.py) and mirrors the alert rule:
       each stop-work start/extension -> `STRIKE <remaining seconds>`; when the site's
       stop-work expires (or is overridden) -> `ALLCLEAR`.

Usage (from the repo root):
    pip install -r hardware/site-beacon/bridge/requirements.txt
    python hardware/site-beacon/bridge/bridge.py --site site_6043 --port COM5          # ML mode
    python hardware/site-beacon/bridge/bridge.py --watch-state site_6043 --port COM5   # live mode
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
DEFAULT_SCORES = REPO_ROOT / "backend" / "workers" / "data" / "live" / "scores_latest.json"
STOP_WORK_FILE = REPO_ROOT / "backend" / "workers" / "data" / "live" / "stop_work.json"


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


def run_scores_mode(args, send) -> None:
    scores_file = Path(args.scores)
    if not scores_file.exists():
        print(f"error: {scores_file} not found. Run backend/ml/src/cypress_ml/score.py first.", file=sys.stderr)
        return
    sent = ""
    strike_started = False
    while True:
        score, scored_at = None, None
        try:
            score, scored_at = latest_score(scores_file, args.site)
        except json.JSONDecodeError as exc:
            print(f"warning: could not parse scores file ({exc}); retrying", file=sys.stderr)
        if score is None:
            print(f"warning: no score for {args.site} yet (scored_at={scored_at})", file=sys.stderr)
        else:
            if score >= args.trigger and not strike_started:
                strike_started = True
                send(f"STRIKE {args.strike_seconds}")
            elif score < args.trigger and strike_started:
                strike_started = False
            val = str(int(round(score)))
            if val != sent:
                sent = val
                send(f"HAZARD {val}")
        time.sleep(args.interval)


def run_watch_state_mode(args, send) -> None:
    sent_remaining: set[int] = set()
    was_active = False
    while True:
        remaining = None
        try:
            remaining = active_stop_remaining(STOP_WORK_FILE, args.site)
        except FileNotFoundError:
            print("warning: stop_work.json not written yet (engine not running?)", file=sys.stderr)
        except (json.JSONDecodeError, KeyError, ValueError) as exc:
            print(f"warning: stop_work.json unreadable ({exc})", file=sys.stderr)
        active = remaining is not None and remaining > 0
        if active:
            if not was_active or remaining not in sent_remaining:  # start or a fresh extension
                send(f"STRIKE {max(remaining, 60)}")
                sent_remaining.add(remaining)
        elif was_active:  # expired or overridden -> all clear
            send("ALLCLEAR")
            sent_remaining = set()
        was_active = active
        time.sleep(args.interval)


def main() -> int:
    ap = argparse.ArgumentParser(description="Feed ML hazard scores / live stop-work state to the beacon.")
    ap.add_argument("--site", help="site_id, e.g. site_6043 (ML scores mode)")
    ap.add_argument("--watch-state", metavar="SITE_ID", help="mirror the live stop-work engine for this site")
    ap.add_argument("--port", default=None, help="COM5, /dev/ttyUSB0, ... (omit with --no-device)")
    ap.add_argument("--baud", type=int, default=9600)
    ap.add_argument("--scores", default=str(DEFAULT_SCORES), help="scores_latest.json to poll")
    ap.add_argument("--interval", type=float, default=60.0, help="poll interval in seconds")
    ap.add_argument("--trigger", type=float, default=8.0, help="hazard score that starts a strike (8 = extreme)")
    ap.add_argument("--strike-seconds", type=int, default=1800, help="stop-work duration (rule: last strike + 30 min)")
    ap.add_argument("--no-device", action="store_true", help="dry run: print commands instead of writing serial")
    args = ap.parse_args()

    if not args.no_device and not args.port:
        ap.error("--port is required unless --no-device is given")
    if bool(args.site) == bool(args.watch_state):
        ap.error("give exactly one of --site SITE_ID (ML scores) or --watch-state SITE_ID (live engine state)")
    if args.watch_state:
        args.site = args.watch_state

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
        if args.watch_state:
            run_watch_state_mode(args, send)
        else:
            run_scores_mode(args, send)
    except KeyboardInterrupt:
        return 0
    finally:
        if device:
            device.close()


if __name__ == "__main__":
    raise SystemExit(main())
