"""GOES GLM lightning ingest (NOAA buckets, anonymous; requests + netCDF4).

Usage (from the repo root, conda env active):
    python backend/workers/cypress_workers/ingest/lightning_glm.py            # one pass
    python backend/workers/cypress_workers/ingest/lightning_glm.py --loop 60  # poll every 60 s

Downloads the newest L2 flash files for one satellite (GOES-19 is now GOES-East and covers
Florida with GLM-2; GOES-16 is on standby and its archive stops April 2025), keeps
only flashes inside the Florida box, and records:

    backend/workers/data/live/lightning_latest.json  {fetched_at, satellite, flashes: [...]}
    backend/workers/data/live/archive/glm/*.nc       raw files, pruned to the newest --keep

Flash records passed downstream (the stop-work engine matches them to sites):
    {"lat", "lon", "energy_fj", "observed_at", "age_s", "object": filename}

When the satellite feed stalls, {fetched_at} in lightning_latest.json simply stops
advancing; the engine treats old strikes as stale and the API as evidence of staleness.
"""
import argparse
import json
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from netCDF4 import Dataset

from cypress_workers.common import LIVE, LIGHTNING_FILE, now_iso, read_json, write_json

BUCKET = "https://noaa-goes{sat}.s3.amazonaws.com/"
PREFIX = "GLM-L2-LCFA"  # real-time GLM product on the NOAA buckets (GLMF-M3 was retired in 2025)
NAME = re.compile(r"_s(\d{13,14})_e(\d{13,14})_c\d+\.nc")  # 13 = seconds, 14 = deciseconds (last char dropped)
FLASH_BOX = {"lat_min": 22.0, "lat_max": 33.0, "lon_min": -91.0, "lon_max": -75.0}  # FL + margin
CACHE_DIR = LIVE / "archive" / "glm"
NS = {"s": "http://s3.amazonaws.com/doc/2006-03-01/"}


def _lamp(stamp: str) -> datetime:
    """GLM file stamps are Julian-day style: s20262902243200 = 2026-290 22:43:20 (+ optional deciseconds)."""
    if len(stamp) == 14:  # decisecond resolution; seconds precision is plenty for a 10-mile rule
        stamp = stamp[:-1]
    return datetime.strptime(stamp, "%Y%j%H%M%S").replace(tzinfo=timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _hour_dirs(now: datetime, back: int = 2) -> list[str]:
    out = []
    for h in range(back + 1):
        when = now - timedelta(hours=h)
        out.append(f"{when.year}/{when.timetuple().tm_yday:03d}/{when.hour:02d}")
    return out


def list_objects(sat: str, folder: str) -> list[tuple[str, str]]:
    r = requests.get(BUCKET.format(sat=sat), params={"list-type": "2", "prefix": f"{PREFIX}/{folder}"}, timeout=60)
    if r.status_code == 404:
        return []
    r.raise_for_status()
    out = []
    for c in ET.fromstring(r.text).findall(".//s:Contents", NS):
        key = c.find("s:Key", NS).text
        m = NAME.search(key)
        if m:
            out.append((m.group(2), key))
    return sorted(set(out))


def flash_records(path: Path, file_start: datetime, now: datetime) -> list[dict]:
    """One flash per record. Handles both GLM schemas: classic (flash_latitude...) and GLM-2 LCFA."""
    ds = Dataset(path, "r")
    try:
        lat_var = ds.variables.get("flash_lat") or ds.variables.get("flash_latitude")
        lon_var = ds.variables.get("flash_lon") or ds.variables.get("flash_longitude")
        offset_var = (ds.variables.get("flash_time_offset_of_first_event")
                      or ds.variables.get("flash_time_offset_of_process"))
        energy = ds.variables.get("flash_energy")
        if not lat_var or not lon_var or not offset_var:  # unknown schema: nothing to extract
            return []
        lats, lons, offset = lat_var[:], lon_var[:], offset_var[:]
        out = []
        for i in range(len(lats)):
            lat, lon = float(lats[i]), float(lons[i])
            if not (FLASH_BOX["lat_min"] <= lat <= FLASH_BOX["lat_max"]
                    and FLASH_BOX["lon_min"] <= lon <= FLASH_BOX["lon_max"]):
                continue
            obs = file_start + timedelta(seconds=float(offset[i]))
            e = float(energy[i]) if energy is not None and energy[i].size and energy[i] > 0 else None
            out.append({"lat": round(lat, 4), "lon": round(lon, 4),
                        "energy_fj": round(e * 1e15, 1) if e else None,
                        "observed_at": _iso(obs),
                        "age_s": max(0, int((now - obs).total_seconds())),
                        "object": path.name})
        return out
    finally:
        ds.close()


def poll(satellite: str = "16", keep: int = 8) -> list[dict]:
    """One pass: fetch and parse every file ending after the saved resume point."""
    prev = read_json(LIGHTNING_FILE, {}) or {}
    if prev.get("satellite") != satellite:  # satellite switched: restart the window
        prev = {"last_end": "0", "last_fetched": None}
    last_end = prev.get("last_end", "0")

    now = datetime.now(timezone.utc)
    fresh: list[dict] = []
    for folder in _hour_dirs(now):
        for end_stamp, key in list_objects(satellite, folder):
            if end_stamp <= last_end:  # already processed
                continue
            if (now - _lamp(end_stamp)).total_seconds() > max(6 * keep, 25 * 60):
                continue  # far beyond what the stop-work window needs
            name = key.split("/")[-1]
            path = CACHE_DIR / name
            try:
                if not path.exists():
                    path.parent.mkdir(parents=True, exist_ok=True)
                    r = requests.get(f"{BUCKET.format(sat=satellite)}{key}", stream=True, timeout=300)
                    r.raise_for_status()
                    tmp = path.with_suffix(".part")
                    with open(tmp, "wb") as f:
                        for chunk in r.iter_content(1 << 20):
                            f.write(chunk)
                    tmp.rename(path)
                fresh += flash_records(path, _lamp(NAME.search(name).group(1)), now)
                last_end = max(last_end, end_stamp)
            except Exception as e:  # one bad satellite file must not stop ingest
                print(f"  warn: {name}: {e}")

    if CACHE_DIR.exists():  # keep only the newest --keep files
        files = sorted(CACHE_DIR.glob("*.nc"))
        for old in files[:-keep]:
            old.unlink(missing_ok=True)

    flashes = [*fresh, *(prev.get("flashes", []) if isinstance(prev.get("flashes"), list) else [])]
    flashes = sorted(flashes, key=lambda f: f["observed_at"])
    kept = 3000
    snapshot = {"fetched_at": _iso(now), "satellite": satellite, "last_end": last_end,
                "new_flashes": len(fresh), "flashes": flashes[-kept:]}
    write_json(LIGHTNING_FILE, snapshot)
    return fresh


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--satellite", default="19", choices=["16", "18", "19"])
    ap.add_argument("--loop", type=float, default=0, help="seconds between passes; 0 = run once")
    ap.add_argument("--keep", type=int, default=8)
    args = ap.parse_args()

    while True:
        began = time.time()
        try:
            fresh = poll(args.satellite, args.keep)
            near = [f for f in fresh if f["age_s"] < 1800]
            print(f"[{now_iso()}] {args.satellite}: +{len(fresh)} flashes "
                  f"({len(near)} in the last 30 min), last_end={json.loads(LIGHTNING_FILE.read_text())['last_end']}")
        except Exception as e:  # network trouble: keep the loop alive
            print(f"  source_unavailable: {e}")
        if args.loop <= 0:
            break
        time.sleep(max(5, args.loop - (time.time() - began)))


if __name__ == "__main__":
    main()
