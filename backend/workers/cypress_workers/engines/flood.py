"""Flood-risk engine: river sites get a flood-risk warning after a night of heavy rain.

Deterministic rule (the plan's flood requirement, contracts/README.md):
  - Rain trigger: hourly precipitation from 6 PM local time yesterday through 6 AM today,
    capped at the site's current observed hour, >= FLOOD_RAIN_INCHES on a river site.
  - NWS trigger: an active NWS flood alert whose areaDesc lists the site's county.
  - Gauge trigger: a reporting USGS stage gauge within GAUGE_PROXIMITY_MILES whose stage
    rose >= GAUGE_RISE_FEET over the ingest window.

"River-relevant" = the site list says river_site:true, a non-X FEMA flood_zone, or the site
is within GAUGE_PROXIMITY_MILES of a USGS stage gauge (real rivers have gauges). Gauge
COORDINATES are permanent, so relevance uses them even when the snapshot is old; only the
stage/rise numbers need a fresh snapshot.

Input files (backend/workers/data/live/):
  weather_latest.json   ingest/weather_live.py (hourly precipitation for overnight rain)
  river_gauges.json     ingest/river_gauges.py (USGS gage height 00065; optional input)
  flood_alerts.json     ingest/nws_alerts.py (NWS active flood alerts; optional input)
  flood_queue.json      demo heavy-rain injections, always simulated:true (POST /api/demo/flood-rain)
Output: flood_risk alerts in stop_work.json (severity "warning"; floods never stop work —
rules decide alerts and only lightning sets stop_work_until) + events in events.json.

The engine polls both feeds itself (like engines/lightning.py polls GLM), so the same
process owns the whole alert stream. Demo injections are held in flood_rain_pending.json
for FLOOD_ALERT_HOURS so a restart mid-demo doesn't drop them.
"""
import argparse
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cypress_workers.common import (FLOOD_ALERT_HOURS, FLOOD_ALERTS_FILE, FLOOD_QUEUE_FILE,
                                    FLOOD_RAIN_INCHES, GAUGE_PROXIMITY_MILES, GAUGE_RISE_FEET,
                                    GAUGES_FILE, RISE_WINDOW_HOURS, STOP_WORK_FILE,
                                    WEATHER_FILE, append_events, haversine_miles, iso_now,
                                    load_sites, make_event, new_id, now_iso, read_json,
                                    write_json)

PENDING_FILE = Path(__file__).resolve().parents[2] / "data" / "live" / "flood_rain_pending.json"
SNAPSHOT_MINUTES = 90  # stage/level values older than this are stale, not live evidence


def _ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def tick() -> list[dict]:
    """One engine pass: returns the events it produced (empty if nothing happened)."""
    now = iso_now()
    sites = load_sites()
    gauges_any = _gauge_records()
    gauges = _fresh_gauges(gauges_any, now)
    nws = _fresh_nws(now)
    rain, demo_rain_ids = _overnight_rain(sites, _demo_rain(), now)

    state = read_json(STOP_WORK_FILE, {"server_time": now_iso(), "alerts": []})
    other = [a for a in state.get("alerts", []) if a.get("type") != "flood_risk"]
    mine = [a for a in state.get("alerts", []) if a.get("type") == "flood_risk"]

    events: list[dict] = []
    for site_id in sorted(sites):
        site = sites[site_id]
        raining = rain(site_id)
        raining_is_demo = site_id in demo_rain_ids
        relevant, river_miles = _river_relevant(site, gauges_any)
        evidence, reasons = _triggers(site, relevant, river_miles, raining, raining_is_demo,
                                      gauges, nws, now)
        alert = next((a for a in mine if a["site_id"] == site_id and a["status"] == "active"), None)

        if evidence and alert is None:
            alert = _new_alert(site, evidence, reasons, raining, now, simulated=raining_is_demo)
            mine.append(alert)
            events.append(make_event("flood_alert_started", site_id, {
                "alert_id": alert["alert_id"], "reasons": reasons,
                "evidence_sources": [e["source"] for e in evidence]}, alert["simulated"]))
        elif evidence and alert is not None:  # risk persists: refresh evidence, reasons and expiry
            title, message = _texts(evidence, reasons, raining,
                                    simulated=raining_is_demo or alert.get("simulated", False))
            alert["title"], alert["message"] = title, message
            alert["evidence"] = evidence
            alert["data"] = {"reasons": reasons, "overnight_rain_in": raining}
            alert["expires_at"] = _iso(now + timedelta(hours=FLOOD_ALERT_HOURS))
            alert["simulated"] = alert["simulated"] or raining_is_demo
        elif alert is not None:  # triggers gone: rain window passed, gauges steadied, NWS expired
            alert["status"], alert["cleared_at"] = "cleared", now_iso()
            events.append(make_event("flood_alert_cleared", site_id, {
                "alert_id": alert["alert_id"],
                "reason": "no active flood triggers (rain window passed, gauges steadied, NWS alerts expired)"},
                alert["simulated"]))

    # active alerts + 48 h of history; the rest age out of the file
    tail = _iso(now - timedelta(days=2))
    state["alerts"] = other + [a for a in mine if a["status"] == "active" or (a.get("cleared_at") or "") >= tail]
    state["server_time"] = now_iso()
    write_json(STOP_WORK_FILE, state)
    if FLOOD_QUEUE_FILE.exists():  # demo_rain() already drained the items
        write_json(FLOOD_QUEUE_FILE, [])
    append_events(events)
    return events


# ---------- inputs ----------

def _overnight_rain(sites: dict, demo: dict, now: datetime):
    """(rain lookup, injected site ids). Use observed hours, never forecast hours."""
    real: dict[str, float] = {}
    snap = read_json(WEATHER_FILE, {}) or {}
    fetched = snap.get("fetched_at")
    try:
        weather_is_fresh = bool(fetched) and (now - _ts(fetched)).total_seconds() <= SNAPSHOT_MINUTES * 60
    except ValueError:
        weather_is_fresh = False
    if weather_is_fresh:
        for rec in snap.get("sites", []):
            observed = rec.get("current", {}).get("observed_at_local")
            try:
                local_now = datetime.fromisoformat(observed)
            except (TypeError, ValueError):
                continue
            start = local_now.replace(hour=18, minute=0, second=0, microsecond=0) - timedelta(days=1)
            end = min(local_now, local_now.replace(hour=6, minute=0, second=0, microsecond=0))
            total = 0.0
            has_hours = False
            for hour in rec.get("hourly", []):
                try:
                    at = datetime.fromisoformat(hour["time"])
                    amount = hour.get("precipitation")
                    if start <= at < end and amount is not None:
                        total += float(amount)
                        has_hours = True
                except (KeyError, TypeError, ValueError):
                    continue
            if has_hours:
                real[rec["site_id"]] = round(total, 2)
    fresh = {s: v for s, v in demo.items()
             if now - _ts(v["recorded_at"]) < timedelta(hours=FLOOD_ALERT_HOURS)}

    def rain(site_id: str) -> float | None:
        injected = fresh.get(site_id)
        return injected["overnight_in"] if injected else real.get(site_id)

    return rain, set(fresh)


def _demo_rain() -> dict:
    """Demo injections from the API, persisted so an engine restart mid-demo keeps them."""
    pending: dict = read_json(PENDING_FILE, {})
    for item in read_json(FLOOD_QUEUE_FILE, []):
        site_id = item.get("site_id")
        if site_id:
            pending[site_id] = {"overnight_in": float(item.get("overnight_in", 4.5)),
                                "recorded_at": now_iso()}
    cutoff = (iso_now() - timedelta(hours=FLOOD_ALERT_HOURS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    pending = {k: v for k, v in pending.items() if v.get("recorded_at", "") > cutoff}
    if pending or read_json(FLOOD_QUEUE_FILE, []):
        write_json(PENDING_FILE, pending)
    return pending


def _gauge_records() -> list[dict]:
    """USGS gauges from the ingest snapshot: positions are permanent, numbers may be old."""
    snap = read_json(GAUGES_FILE, {}) or {}
    return snap.get("gauges") or []


def _fresh_gauges(gauges: list[dict], now: datetime) -> list[dict]:
    """Only gauges whose snapshot is new enough for live stage/rise evidence."""
    snap = read_json(GAUGES_FILE, {}) or {}
    fetched = snap.get("fetched_at")
    try:
        age = (now - _ts(fetched)).total_seconds() if fetched else None
    except ValueError:
        return []
    if age is None or age > SNAPSHOT_MINUTES * 60:
        return []
    return [g for g in gauges
            if isinstance(g.get("stage_ft"), (int, float)) and g["stage_ft"] is not None]


def _fresh_nws(now: datetime) -> list[dict]:
    """NWS flood alerts from a fresh snapshot whose `expires` is still ahead."""
    snap = read_json(FLOOD_ALERTS_FILE, {}) or {}
    fetched = snap.get("fetched_at")
    try:
        age = (now - _ts(fetched)).total_seconds() if fetched else None
    except ValueError:
        return []
    if age is None or age > SNAPSHOT_MINUTES * 60:
        return []
    out = []
    for alert in snap.get("alerts", []):
        expires = alert.get("expires")
        if expires and _ts(expires) > now:
            out.append(alert)
    return out


# ---------- rule ----------

def _river_relevant(site: dict, gauges: list[dict]) -> tuple[bool, float | None]:
    """(relevant, miles to nearest gauge). The site list flags win; else a nearby stage gauge."""
    if site.get("river_site"):
        return True, None
    zone = str(site.get("flood_zone") or "").replace(" ", "").upper()
    if zone and zone not in ("X", "C", "BSX"):  # X and C are outside the 500-year floodplain
        return True, None
    near = [g for g in gauges if haversine_miles(site["lat"], site["lon"], g["lat"], g["lon"]) <= GAUGE_PROXIMITY_MILES]
    if near:
        return True, round(min(haversine_miles(site["lat"], site["lon"], g["lat"], g["lon"]) for g in near), 1)
    return False, None


def _triggers(site: dict, relevant: bool, river_miles: float | None, overnight_in: float | None,
              rain_is_demo: bool, gauges: list[dict], nws: list[dict],
              now: datetime) -> tuple[list[dict], list[str]]:
    """(evidence, reasons) when any flood trigger fires for this site, else ([], [])."""
    evidence: list[dict] = []
    reasons: list[str] = []
    rain_source = "simulated-heavy-rain" if rain_is_demo else "open-meteo"

    if overnight_in is not None and overnight_in >= FLOOD_RAIN_INCHES and relevant:
        where = f"{river_miles} mi from a USGS gauge" if river_miles is not None else "flagged river site"
        evidence.append({"source": rain_source, "observed_at": _iso(now)})
        reasons.append(f"{overnight_in:.1f} in of overnight rain (rule threshold {FLOOD_RAIN_INCHES:.0f} in: {where})")
    # heavy rain away from rivers stays silent here: that is a model (score) signal, not an alert rule.

    site_county = str(site.get("county") or "").title()
    if site_county:
        for alert in nws:
            if site_county in (alert.get("counties") or []):
                evidence.append({"source": f"nws:{alert['id']}", "observed_at": alert.get("sent") or _iso(now)})
                reasons.append(f"NWS {alert['event']}" + (f": {alert['headline']}" if alert.get("headline")
                                                          else f" covers {site_county} County"))
                break

    for gauge in gauges:
        rise = gauge.get("rise_ft")
        if rise is None or rise < GAUGE_RISE_FEET:
            continue
        miles = haversine_miles(site["lat"], site["lon"], gauge["lat"], gauge["lon"])
        if miles > GAUGE_PROXIMITY_MILES:
            continue
        evidence.append({"source": f"usgs:{gauge['site_no']}", "observed_at": _iso(now)})
        reasons.append(f"{gauge['name'].strip()}: stage {gauge['stage_ft']:.1f} ft, "
                       f"up {rise:.1f} ft / {RISE_WINDOW_HOURS:.0f} h, {miles:.1f} mi from the site")
        break

    return evidence, reasons


# ---------- alerts ----------

def _texts(evidence: list[dict], reasons: list[str], overnight_in: float | None,
           simulated: bool) -> tuple[str, str]:
    """(title, message) for a flood alert in any of its trigger combinations."""
    if overnight_in is not None and overnight_in >= FLOOD_RAIN_INCHES:
        title = f"Flood risk: {overnight_in:.1f} in of rain overnight"
        message = ("River site with heavy overnight rain. Check access roads, low crossings and "
                   "slippery ground before driving in; move gear above grade.")
    elif any(e["source"].startswith("nws:") for e in evidence):
        title = f"Flood risk: {reasons[0]}"[:90]
        message = "NWS flood alert covers this county. Expect water on access roads; stage outdoor work upstream of low spots."
    else:
        title = "Flood risk: river gauge rising"
        message = "A nearby river gauge is rising fast. Keep crews off low crossings and watch the water level."
    if simulated:  # demo injections are clearly labeled everywhere (demo rules)
        title += " (simulated drill)"
        message = "[Simulated drill] " + message
    return title, message


def _new_alert(site: dict, evidence: list[dict], reasons: list[str],
               overnight_in: float | None, now: datetime, simulated: bool = False) -> dict:
    title, message = _texts(evidence, reasons, overnight_in, simulated)
    return {
        "alert_id": new_id("alt"),
        "site_id": site["site_id"],
        "type": "flood_risk",
        "severity": "warning",  # floods warn; only lightning sets a stop-work
        "status": "active",
        "title": title,
        "message": message,
        "started_at": now_iso(),
        "stop_work_until": None,
        "cleared_at": None,
        "acknowledged_by": [],
        "evidence": evidence,
        "expires_at": _iso(now + timedelta(hours=FLOOD_ALERT_HOURS)),
        "data": {"reasons": reasons, "overnight_rain_in": overnight_in},
        "ledger_record_id": None,
        "simulated": simulated,
    }


def simulate_rain(site_id: str, overnight_in: float = 4.5) -> dict:
    """Queue a demo heavy-rain night (POST /api/demo/flood-rain applies it within one tick)."""
    item = {"site_id": site_id, "overnight_in": overnight_in, "recorded_at": now_iso(), "simulated": True}
    queue = read_json(FLOOD_QUEUE_FILE, []) if FLOOD_QUEUE_FILE.exists() else []
    write_json(FLOOD_QUEUE_FILE, queue + [item])
    return item


def river_relevant_sites() -> list[dict]:
    """Sites the rain rule would actually fire on (flags in the site list, else near a gauge),
    so the demo endpoint can guide the operator to a site that produces an alert."""
    gauges = _gauge_records()
    out = []
    for site_id, site in load_sites().items():
        relevant, miles = _river_relevant(site, gauges)
        if relevant:
            out.append({"site_id": site_id, "name": site["name"], "county": site.get("county"),
                        "gauge_miles": miles})
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Flood-rule engine loop (writes flood_risk alerts + events).")
    ap.add_argument("--loop", type=float, default=30.0, help="seconds between ticks")
    ap.add_argument("--gauge-poll", type=float, default=900.0, help="seconds between USGS passes (0 = never)")
    ap.add_argument("--nws-poll", type=float, default=300.0, help="seconds between NWS passes (0 = never)")
    ap.add_argument("--once", action="store_true", help="one tick and exit")
    args = ap.parse_args()

    from cypress_workers.ingest import nws_alerts, river_gauges
    gauge_last = nws_last = 0.0
    step = 1
    while True:
        try:
            now = time.time()
            if args.gauge_poll > 0 and now - gauge_last >= args.gauge_poll:
                gauge_last = now
                try:
                    river_gauges.poll()
                except Exception as e:  # noqa: BLE001
                    print(f"  [error] river_gauges: {e}")
            if args.nws_poll > 0 and now - nws_last >= args.nws_poll:
                nws_last = now
                try:
                    nws_alerts.poll()
                except Exception as e:  # noqa: BLE001
                    print(f"  [error] nws_alerts: {e}")
            produced = tick()
            active = sum(1 for a in read_json(STOP_WORK_FILE, {}).get("alerts", [])
                         if a.get("type") == "flood_risk" and a.get("status") == "active")
            print(f"[{now_iso()}] flood tick {step}: {len(produced)} event(s), {active} active flood alert(s)")
            for event in produced:
                print(f"  -> {event['type']} {event['site_id']} ({event['event_id']})")
        except Exception as e:  # noqa: BLE001
            print(f"  [error] {e}")
        step += 1
        if args.once:
            break
        time.sleep(args.loop)


if __name__ == "__main__":
    main()
