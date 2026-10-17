"""Site beacon bridge: reads the ML model's hazard scores and drives the Arduino beacon.

The LightGBM hazard-index model is scored server-side by
    backend/ml/src/cypress_ml/score.py
which writes backend/workers/data/live/scores_latest.json. This bridge polls that
file for one site and writes simple commands to the beacon over USB serial:

    HAZARD n        show the model hazard score (0-10) on the LCD while all-clear
    STRIKE sec      start/reset the 30-minute stop-work countdown (score >= trigger)
    ALLCLEAR        back to green (rarely needed; the countdown expires on its own)

Usage (from the repo root):
    pip install -r hardware/site-beacon/bridge/requirements.txt
    python hardware/site-beacon/bridge/bridge.py --site site_6043 --port COM5

Without a serial port attached, use --no-device to just print what would be sent.
"""
import argparse
import json
import sys
import time
from pathlib import Path

BRIDGE_DIR = Path(__file__).resolve().parent
REPO_ROOT = BRIDGE_DIR.parents[2]
DEFAULT_SCORES = REPO_ROOT / "backend" / "workers" / "data" / "live" / "scores_latest.json"


def latest_score(scores_file: Path, site_id: str):
    """Return (score, scored_at) for the site's local today, or (None, None)."""
    data = json.loads(scores_file.read_text())
    for rec in data.get("scores", []):
        if rec["site_id"] == site_id and rec.get("day_offset", 1) == 0:
            return rec["hazard_score"], data.get("scored_at")
    return None, data.get("scored_at")


def main() -> int:
    ap = argparse.ArgumentParser(description="Feed ML hazard scores to the site beacon.")
    ap.add_argument("--site", required=True, help="site_id, e.g. site_6043")
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
    scores_file = Path(args.scores)
    if not scores_file.exists():
        print(f"error: {scores_file} not found. Run backend/ml/src/cypress_ml/score.py first.", file=sys.stderr)
        return 1

    device = None
    if not args.no_device:
        import serial
        device = serial.Serial(args.port, args.baud, timeout=2)
        time.sleep(2.0)  # Uno boards reset when the port opens

    sent = ""
    strike_started = False

    def send(cmd: str) -> None:
        nonlocal sent
        print(f"-> {cmd}", flush=True)
        if device:
            device.write((cmd + "\n").encode("ascii"))
            device.flush()

    try:
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
    except KeyboardInterrupt:
        return 0
    finally:
        if device:
            device.close()


if __name__ == "__main__":
    raise SystemExit(main())
