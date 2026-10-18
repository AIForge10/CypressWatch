"""NWS flood-alert ingest (api.weather.gov, anonymous; requests only).

Usage (from the workers dir):
    python -m cypress_workers.ingest.nws_alerts             # one pass
    python -m cypress_workers.ingest.nws_alerts --loop 300  # poll every 5 min
    from cypress_workers.ingest import nws_alerts; nws_alerts.poll()  # from the engine

Fetches active NWS alerts for Florida, keeps the flood family only, and saves:

    backend/workers/data/live/flood_alerts.json
      {fetched_at, alerts: [{id, sent, effective, expires, event, severity, headline,
                             area_desc, counties}]}

many flood products are issued for forecast zones rather than polygons, so the engine
matches a site by the COUNTY NAMES listed in areaDesc (counties are title-cased to match
sites.json). Expiration makes each alert stale on its own: old alerts are dropped here
and the engine double-checks `expires` before using them as evidence.
"""
import argparse
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

from cypress_workers.common import FLOOD_ALERTS_FILE, now_iso, write_json

URL = "https://api.weather.gov/alerts/active"
AREA = "FL"
# Only products that mean wet ground for a job site; watches/advisories warn earlier.
KEEP_EVENTS = {"flood warning", "flash flood warning", "flood watch", "flash flood watch",
               "flood advisory"}
ZONE_CODE = re.compile(r"^[A-Z]{2}[CZ]\d{1,3}(-[A-Z]\w*)?$")  # forecast-zone ids, e.g. FLZ168
ST_SUFFIX = re.compile(r"^(?P<name>.+?),?\s*(?P<st>[A-Z]{2})$")  # "Broward, FL" -> "Broward"
HEADERS = {"User-Agent": "CypressWatch hackathon project", "Accept": "application/geo+json"}


def _ts(s: str | None) -> datetime | None:
    if not s:
        return None
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)


def poll(area: str = AREA) -> dict | None:
    r = requests.get(URL, params={"area": area, "status": "actual"}, timeout=60, headers=HEADERS)
    r.raise_for_status()
    alerts = _parse(r.json())
    snapshot = {"fetched_at": now_iso(), "alerts": alerts}
    write_json(FLOOD_ALERTS_FILE, snapshot)
    print(f"  nws_alerts: {len(alerts)} active flood alert(s) -> {FLOOD_ALERTS_FILE.name}")
    return snapshot


def _counties(area_desc: str) -> list[str]:
    """areaDesc segments are county names with state suffixes ("Broward, FL") or forecast-zone
    codes (FLZ168). Keep county-ish names (state suffix dropped) so they match sites.json.
    Zone-coded products fall back to the engine's other triggers (rain, gauges)."""
    out = []
    for segment in area_desc.split(";"):
        segment = segment.strip()
        if not segment or ZONE_CODE.match(segment):
            continue
        match = ST_SUFFIX.match(segment)
        name = (match.group("name") if match else segment).strip()
        if re.search(r"[A-Za-z]", name):
            out.append(name.title())
    return sorted(set(out))


def _parse(body: dict) -> list[dict]:
    now = datetime.now(timezone.utc)
    out = []
    for item in body.get("features", []):
        try:
            props = item["properties"]
            event = str(props.get("event", "")).strip()
            if event.lower() not in KEEP_EVENTS:
                continue
            expires = _ts(props.get("expires"))
            if expires and expires <= now:  # already over; not evidence
                continue
            counties = _counties(str(props.get("areaDesc", "")))
            out.append({
                "id": props.get("id"),
                "sent": props.get("sent"),
                "effective": props.get("effective"),
                "expires": props.get("expires"),
                "event": event,
                "severity": props.get("severity"),
                "headline": props.get("headline"),
                "area_desc": props.get("areaDesc"),
                "counties": sorted(counties),
            })
        except (KeyError, TypeError, ValueError):
            continue
    return sorted(out, key=lambda a: (a["event"], a["area_desc"] or ""))


def main() -> None:
    ap = argparse.ArgumentParser(description="NWS active flood-alert poller (writes flood_alerts.json).")
    ap.add_argument("--loop", type=float, default=0.0, help="seconds between polls (0 = one pass)")
    ap.add_argument("--area", default=AREA, help="state code (ALPS area parameter)")
    args = ap.parse_args()
    while True:
        try:
            poll(args.area)
        except Exception as e:  # noqa: BLE001
            print(f"  [error] nws_alerts: {e}")
        if not args.loop:
            break
        time.sleep(args.loop)


if __name__ == "__main__":
    main()
