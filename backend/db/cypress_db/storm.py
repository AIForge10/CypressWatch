"""Storm approach warning: is lightning moving toward a site, how fast, and when will it cross 10 miles?

Usage (from the repo root):
    python backend/db/cypress_db/storm.py status site_6043            # approach + stop-work status now
    python backend/db/cypress_db/storm.py simulate site_6043          # DEMO: a storm 20 mi SW moving in at ~15 mph

From Python (API site detail, alerts):
    from cypress_db import storm
    storm.storm_approach("site_6043")
    # {"approaching": True, "speed_mph": 14.8, "nearest_miles": 14.3, "direction": "SW",
    #  "eta_stop_work_minutes": 19, "summary": "Lightning 14 mi SW, moving in at ~15 mph. Reaches the 10-mile
    #   stop-work line in about 19 min.", ...}

How it works, all in SQL on Tiger:
  1. Strikes within 40 miles in the last 30 minutes, grouped into 5-minute buckets with time_bucket().
  2. For each bucket, the distance of the nearest strike to the site.
  3. regr_slope(distance, time) = how fast the storm's leading edge is closing in (miles per minute).
  4. ETA = (nearest distance - 10 miles) / closing speed. Direction = average bearing of recent strikes.
"""
import argparse
import json
import math
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/db
from cypress_db import db  # noqa: E402

WATCH_MILES, WINDOW_MIN, BUCKET_MIN = 40, 30, 5
COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


def _compass(deg: float) -> str:
    return COMPASS[int(((deg % 360) + 22.5) // 45) % 8]


def storm_approach(site_id: str, watch_miles: float = WATCH_MILES, window_min: int = WINDOW_MIN,
                   bucket_min: int = BUCKET_MIN, stop_miles: float = db.STOP_WORK_MILES) -> dict:
    dist = db._distance_sql("l.lat", "l.lon", "s.lat", "s.lon")
    bearing = ("degrees(atan2(sin(radians(l.lon - s.lon)) * cos(radians(l.lat)), "
               "cos(radians(s.lat)) * sin(radians(l.lat)) - sin(radians(s.lat)) * cos(radians(l.lat)) * "
               "cos(radians(l.lon - s.lon))))")
    bucket = ("time_bucket(make_interval(mins => %(bucket)s), l.time)" if db.has_timescale() else
              "to_timestamp(floor(extract(epoch FROM l.time) / (%(bucket)s * 60)) * (%(bucket)s * 60))")
    with db.conn() as c:
        rows = c.execute(
            f"""WITH recent AS (
                    SELECT l.time, {bucket} AS b, {dist} AS d, {bearing} AS brg
                    FROM lightning_strikes l JOIN sites s ON s.site_id = %(site)s
                    WHERE l.time > now() - make_interval(mins => %(window)s)
                      AND {db._near_box('l.lat', 'l.lon', 's.lat', 's.lon', '%(watch)s')}),
                per_bucket AS (
                    SELECT b, min(d) AS nearest, count(*) AS n FROM recent WHERE d <= %(watch)s GROUP BY b)
                SELECT (SELECT count(*) FROM per_bucket) AS buckets,
                       (SELECT sum(n) FROM per_bucket) AS strikes,
                       (SELECT regr_slope(nearest, extract(epoch FROM b) / 60.0) FROM per_bucket) AS miles_per_min,
                       (SELECT nearest FROM per_bucket ORDER BY b DESC LIMIT 1) AS latest_nearest,
                       (SELECT min(d) FROM recent WHERE d <= %(watch)s) AS nearest_now,
                       (SELECT degrees(atan2(avg(sin(radians(brg))), avg(cos(radians(brg))))) FROM recent
                         WHERE d <= %(watch)s AND time > now() - INTERVAL '10 minutes') AS bearing_deg,
                       (SELECT bool_or(simulated) FROM lightning_strikes l JOIN sites s ON s.site_id = %(site)s
                         WHERE l.time > now() - make_interval(mins => %(window)s)
                           AND {db._near_box('l.lat', 'l.lon', 's.lat', 's.lon', '%(watch)s')}) AS simulated""",
            {"site": site_id, "watch": watch_miles, "window": window_min, "bucket": bucket_min}).fetchone()

    out = {"site_id": site_id, "checked_at": db._iso(datetime.now(timezone.utc)), "watch_miles": watch_miles,
           "window_minutes": window_min, "strikes": int(rows["strikes"] or 0), "approaching": False,
           "speed_mph": None, "nearest_miles": None, "direction": None, "eta_stop_work_minutes": None,
           "inside_stop_work": False, "simulated": bool(rows["simulated"]), "summary": ""}
    if not rows["strikes"]:
        out["summary"] = f"No lightning within {watch_miles:.0f} miles in the last {window_min} minutes."
        return out
    nearest = float(rows["latest_nearest"] if rows["latest_nearest"] is not None else rows["nearest_now"])
    out["nearest_miles"] = round(float(rows["nearest_now"]), 1)
    out["direction"] = _compass(rows["bearing_deg"]) if rows["bearing_deg"] is not None else None
    out["inside_stop_work"] = out["nearest_miles"] <= stop_miles
    where = f"{out['nearest_miles']:.0f} mi {out['direction']}" if out["direction"] else f"{out['nearest_miles']:.0f} mi away"

    slope = rows["miles_per_min"]
    if rows["buckets"] >= 3 and slope is not None and slope < -0.05:  # closing faster than 3 mph
        speed = -float(slope) * 60
        out.update(approaching=True, speed_mph=round(speed, 1))
        if out["inside_stop_work"]:
            out["summary"] = (f"Lightning {where}, inside the 10-mile stop-work zone and still moving in "
                              f"(~{speed:.0f} mph).")
        else:
            eta = max(0, (nearest - stop_miles) / (-float(slope)))
            out["eta_stop_work_minutes"] = round(eta)
            out["summary"] = (f"Lightning {where}, moving in at ~{speed:.0f} mph. Reaches the 10-mile stop-work "
                              f"line in about {round(eta)} min.")
    elif rows["buckets"] < 3:
        out["summary"] = f"Lightning {where}. Watching for movement (need 15 minutes of strikes)."
    elif slope is not None and slope > 0.05:
        out["summary"] = f"Lightning {where}, moving away (~{float(slope) * 60:.0f} mph)."
    else:
        out["summary"] = f"Lightning {where}, not clearly approaching."
    if out["simulated"]:
        out["summary"] += " (simulated for demo)"
    return out


def _offset(lat: float, lon: float, miles: float, bearing_deg: float) -> tuple[float, float]:
    d, b = miles / db.EARTH_MILES, math.radians(bearing_deg)
    la1, lo1 = math.radians(lat), math.radians(lon)
    la2 = math.asin(math.sin(la1) * math.cos(d) + math.cos(la1) * math.sin(d) * math.cos(b))
    lo2 = lo1 + math.atan2(math.sin(b) * math.sin(d) * math.cos(la1), math.cos(d) - math.sin(la1) * math.sin(la2))
    return math.degrees(la2), math.degrees(lo2)


def simulate_storm(site_id: str, start_miles: float = 20, speed_mph: float = 15, bearing_deg: float = 225,
                   minutes_ago: int = 25, steps: int = 6, strikes_per_step: int = 3, seed: int | None = None) -> int:
    """DEMO: strikes from a storm `start_miles` away (default SW) moving toward the site, flagged simulated.
    Strikes are spread over the last `minutes_ago` minutes so storm_approach() can measure the speed right away."""
    site = db._site(site_id)
    if not site:
        raise KeyError(f"Unknown site {site_id}")
    rng = random.Random(seed)
    now = datetime.now(timezone.utc)
    strikes = []
    for i in range(steps):
        t = now - timedelta(minutes=minutes_ago * (1 - i / max(steps - 1, 1))) if steps > 1 else now
        elapsed_h = (t - (now - timedelta(minutes=minutes_ago))).total_seconds() / 3600
        front = max(0.5, start_miles - speed_mph * elapsed_h)
        for _ in range(strikes_per_step):
            lat, lon = _offset(site["lat"], site["lon"], front + rng.uniform(0, 3), bearing_deg + rng.uniform(-12, 12))
            strikes.append({"time": t + timedelta(seconds=rng.uniform(0, 50)), "lat": lat, "lon": lon,
                            "source": "simulated", "simulated": True})
    return db.save_strikes(strikes)


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    st = sub.add_parser("status")
    st.add_argument("site_id")
    sim = sub.add_parser("simulate")
    sim.add_argument("site_id")
    sim.add_argument("--start-miles", type=float, default=20)
    sim.add_argument("--speed", type=float, default=15)
    sim.add_argument("--bearing", type=float, default=225, help="where the storm is, degrees (225 = SW)")
    sim.add_argument("--minutes-ago", type=int, default=25)
    sim.add_argument("--steps", type=int, default=6)
    args = ap.parse_args()

    if args.cmd == "simulate":
        n = simulate_storm(args.site_id, args.start_miles, args.speed, args.bearing, args.minutes_ago, args.steps)
        print(f"Added {n} simulated strikes")
    a = storm_approach(args.site_id)
    print(a["summary"])
    print(json.dumps({k: a[k] for k in ("approaching", "speed_mph", "nearest_miles", "direction",
                                         "eta_stop_work_minutes", "inside_stop_work", "strikes")}))
    print(f"Stop-work: {db.stop_work_status(args.site_id)}")


if __name__ == "__main__":
    main()