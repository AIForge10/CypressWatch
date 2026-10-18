"""Keep Tiger Data fresh.

Every N minutes: push the live files (scores, weather, strikes) into Tiger,
then refresh "days like today". Runs next to the API, locally or on Vultr.

    cd backend/db
    python -m cypress_db.sync            # loop every 5 min
    python -m cypress_db.sync --once     # one sync, then exit
"""
import argparse
import time
import traceback
from datetime import datetime

from cypress_db import db, history


def sync_once() -> None:
    t = time.time()
    db.load_live()
    try:
        history.refresh_analogs()
    except Exception as e:  # noqa: BLE001 - analogs are a bonus, never block the sync
        print("  analogs skipped:", str(e).splitlines()[0])
    print(f"[{datetime.now():%H:%M:%S}] synced to Tiger in {time.time() - t:.1f}s")


def main() -> None:
    ap = argparse.ArgumentParser(description="Push live data into Tiger Data on a loop")
    ap.add_argument("--every", type=float, default=5, help="minutes between syncs (default 5)")
    ap.add_argument("--once", action="store_true", help="sync once and exit")
    args = ap.parse_args()
    while True:
        try:
            sync_once()
        except Exception:  # noqa: BLE001 - keep looping; Tiger may blip
            traceback.print_exc()
        if args.once:
            break
        time.sleep(args.every * 60)


if __name__ == "__main__":
    main()