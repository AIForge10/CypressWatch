"""USGS river-gauge ingest (anonymous NWIS instant-values service; requests only).

Usage (from the workers dir):
    python -m cypress_workers.ingest.river_gauges            # one pass
    python -m cypress_workers.ingest.river_gauges --loop 900 # poll every 15 min
    from cypress_workers.ingest import river_gauges; river_gauges.poll()  # from the engine

Asks the USGS Instantaneous Values service for gage height (parameter 00065) at every
Florida monitoring station over the last RISE_WINDOW_HOURS, computes each gauge's rise
over that window, and saves:

    backend/workers/data/live/river_gauges.json
      {fetched_at, period_hours, gauges: [{site_no, name, lat, lon, stage_ft, rise_ft}]}

The flood engine (engines/flood.py) matches gauges to river sites by distance and uses
rise_ft as its "river rising right now" evidence. When the feed stalls or the service is
unreachable, river_gauges.json keeps its old fetched_at; the consumer treats that as
stale (visible old data is never presented as live).
"""
import argparse
import time
from pathlib import Path

import requests

from cypress_workers.common import GAUGES_FILE, now_iso, write_json

URL = "https://nwis.waterservices.usgs.gov/nwis/iv"
# Gage height in feet: 00065. Discharge (00060) varies per river; stage rise is comparable.
PARAMETER_CD = "00065"
STATE_CD = "FL"


def poll(state_cd: str = STATE_CD, window_hours: float = 3.0, timeout: int = 90) -> dict | None:
    """One ingest pass. Returns the snapshot written, or None when the service is unreachable."""
    # NWIS only treats startDT as a range when endDT is also sent; a bare `period` does work.
    params = {"format": "json", "parameterCd": PARAMETER_CD, "stateCd": state_cd.lower(),
              "period": f"PT{int(window_hours)}H"}
    r = requests.get(URL, params=params, timeout=timeout, headers={"User-Agent": "CypressWatch hackathon project"})
    if r.status_code == 404:
        return None  # no stations matched; keep the old file
    r.raise_for_status()
    gauges = _parse_iv(r.json())
    snapshot = {"fetched_at": now_iso(), "window_hours": window_hours, "gauges": gauges}
    write_json(GAUGES_FILE, snapshot)
    population = sum(1 for g in gauges if g["stage_ft"] is not None)
    print(f"  river_gauges: {len(gauges)} stations ({population} reporting) -> {GAUGES_FILE.name}")
    return snapshot


def _parse_iv(body: dict) -> list[dict]:
    """NWIS IV JSON: one entry per value-series. Latest value = stage, rise = max - min over the window."""
    out = []
    for series in body.get("value", {}).get("timeSeries", []):
        try:
            info = series["sourceInfo"]
            site_no = info["siteCode"][0]["value"]
            name = info["siteName"]
            geo = info["geoLocation"]["geogLocation"]
            lat, lon = float(geo["latitude"]), float(geo["longitude"])
        except (KeyError, IndexError, TypeError, ValueError):
            continue
        samples = []
        for block in series.get("values", []):
            for v in block.get("value", []):
                try:  # some gauges report provisional flags or placeholder negatives
                    samples.append((v["dateTime"], float(v["value"])))
                except (KeyError, TypeError, ValueError):
                    continue
        stage = samples[-1][1] if samples else None
        if stage is not None and stage < 0:  # missing-value sentinels (e.g. -999999) are not water
            stage = None
        stage = round(stage, 2) if stage is not None else None
        rise = None
        if stage is not None:
            window = [v for _, v in samples if v >= 0]
            if len(window) >= 2 and max(window) > min(window):
                rise = round(max(window) - min(window), 2)
        out.append({"site_no": site_no, "name": name, "lat": lat, "lon": lon,
                    "stage_ft": stage, "rise_ft": rise})
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="USGS gage-height poller (writes river_gauges.json).")
    ap.add_argument("--loop", type=float, default=0.0, help="seconds between polls (0 = one pass)")
    ap.add_argument("--state", default=STATE_CD)
    ap.add_argument("--window", type=float, default=3.0, help="rise window in hours")
    args = ap.parse_args()
    while True:
        try:
            poll(args.state, args.window)
        except Exception as e:  # noqa: BLE001
            print(f"  [error] river_gauges: {e}")
        if not args.loop:
            break
        time.sleep(args.loop)


if __name__ == "__main__":
    main()
