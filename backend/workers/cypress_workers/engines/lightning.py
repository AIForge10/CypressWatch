"""Lightning stop-work engine: the ONLY code path allowed to start or end a stop-work.

Real-time rule (Sperry requirement, contracts/README.md):
  - Any strike within 10 miles of a site starts a stop-work.
  - All-clear is 30 minutes after the most recent strike, so each new strike within
    10 miles moves stop_work_until forward (the countdown restarts).

Inputs (backend/workers/data/live/):
  lightning_latest.json  real flashes from ingest/lightning_glm.py
  strikes_queue.json     demo strikes (API POST /api/demo/strike), simulated:true
  alert_actions.json     acks/overrides queued by the API
Output: stop_work.json (alerts state, contract AlertsResponse shape) + events.json (LiveEvent log).

Loop: `python -m cypress_workers.engines.lightning --loop 5` (back in the workers dir).
One tick from Python: `from cypress_workers.engines.lightning import tick; tick()`.
"""
import argparse
import math
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cypress_workers.common import (ALERT_ACTIONS_FILE, LIGHTNING_FILE, STOP_WORK_FILE,
                                    STOP_WORK_MILES, STOP_WORK_SECONDS, STRIKES_QUEUE_FILE,
                                    append_events, haversine_miles, iso_now, load_sites, make_event,
                                    new_id, now_iso, read_json, write_json)

STALE_FLASH_SECONDS = 35 * 60  # older strikes are historical, not live evidence


def _ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _alert_text(distance: float) -> tuple[str, str]:
    return (f"Stop work: lightning {round(distance, 1)} miles away",
            f"Lightning struck within {STOP_WORK_MILES:.0f} miles. Stop outdoor work and shelter. "
            f"All clear 30 minutes after the last strike.")


def tick() -> list[dict]:
    """One engine pass: returns the events it produced (empty if nothing happened)."""
    sites = load_sites()
    state = read_json(STOP_WORK_FILE, {"server_time": now_iso(), "alerts": []})
    if not isinstance(state, dict) or not isinstance(state.get("alerts"), list):
        state = {"server_time": now_iso(), "alerts": []}
    queued_strikes = read_json(STRIKES_QUEUE_FILE, []) if STRIKES_QUEUE_FILE.exists() else []
    queued_actions = read_json(ALERT_ACTIONS_FILE, []) if ALERT_ACTIONS_FILE.exists() else []
    events: list[dict] = []

    # 1) live strikes (GLM + queued demo strikes) within 10 miles -> start / extend
    live = _live_strike_map(sites, _recent_flashes(), queued_strikes)
    for site_id, strike in live.items():
        event = _apply_strike(state, site_id, strike)
        if event:
            events.append(event)

    # 2) expiry -> all_clear (30 minutes after the most recent strike)
    now = iso_now()
    for alert in state["alerts"]:
        if alert["status"] == "active" and _ts(alert["stop_work_until"]) <= now:
            alert["status"], alert["cleared_at"] = "cleared", now_iso()
            events.append(make_event("all_clear", alert["site_id"], {
                "alert_id": alert["alert_id"],
                "reason": "30 minutes with no strikes within 10 miles"}, alert["simulated"]))

    # 3) queued acks / overrides
    for action in queued_actions:
        event = _apply_action(state, action)
        if event:
            events.append(event)

    state["alerts"] = state["alerts"][-200:]  # keep the file small
    state["server_time"] = now_iso()
    write_json(STOP_WORK_FILE, state)
    if queued_strikes:
        write_json(STRIKES_QUEUE_FILE, [])
    if queued_actions:
        write_json(ALERT_ACTIONS_FILE, [])
    append_events(events)
    return events


# ---------- inputs ----------

def _recent_flashes() -> list[dict]:
    """Flashes observed less than STALE_FLASH_SECONDS ago, recomputed against now (age_s freezes between polls)."""
    snap = read_json(LIGHTNING_FILE, {}) or {}
    now = iso_now()
    fresh = []
    for f in snap.get("flashes", []):
        try:
            if (now - _ts(f["observed_at"])).total_seconds() <= STALE_FLASH_SECONDS:
                fresh.append(f)
        except (KeyError, ValueError):
            continue
    return fresh


def _place(site: dict, distance_miles: float, bearing_deg: float) -> tuple[float, float]:
    """Site coordinates + distance/bearing -> strike coordinates (for demo strikes)."""
    dkm = distance_miles * 1.60934
    brg, phi = math.radians(bearing_deg), math.radians(site["lat"])
    dl = dkm / 6371.0
    lat2 = math.asin(math.sin(phi) * math.cos(dl) + math.cos(phi) * math.sin(dl) * math.cos(brg))
    lon2 = math.radians(site["lon"]) + math.atan2(
        math.sin(brg) * math.sin(dl) * math.cos(phi),
        math.cos(dl) - math.sin(phi) * math.sin(lat2))
    return round(math.degrees(lat2), 4), round(math.degrees(lon2), 4)


def _live_strike_map(sites: dict, flashes: list[dict], queued: list[dict]) -> dict:
    """site_id -> closest recent strike within STOP_WORK_MILES."""
    live: dict[str, dict] = {}

    for site_id, site in sites.items():  # real GLM flashes first
        best = None
        for f in flashes:
            distance = haversine_miles(site["lat"], site["lon"], f["lat"], f["lon"])
            if distance <= STOP_WORK_MILES and (best is None or distance < best[0]):
                best = (distance, f)
        if best:
            live[site_id] = {"observed_at": best[1]["observed_at"],
                             "distance_miles": round(best[0], 1), "simulated": False}

    for strike in queued:  # demo strikes queued beside them, flagged simulated
        site = sites.get(strike["site_id"])
        if site:
            lat, lon = strike.get("lat"), strike.get("lon")
            if lat is None:
                lat, lon = _place(site, float(strike.get("distance_miles", 4.2)),
                                  float(strike.get("bearing_deg", 250)))
            distance = haversine_miles(site["lat"], site["lon"], lat, lon)
            existing = live.get(strike["site_id"])
            if existing is None or distance < existing["distance_miles"]:
                live[strike["site_id"]] = {"observed_at": strike.get("strike_at") or now_iso(),
                                           "distance_miles": round(distance, 1),
                                           "simulated": bool(strike.get("simulated", True))}
    return live


# ---------- state transitions ----------

def _apply_strike(state: dict, site_id: str, strike: dict) -> dict | None:
    alert = next((a for a in state["alerts"] if a["site_id"] == site_id), None)
    if alert is None or alert["status"] in ("cleared", "overridden"):
        title, message = _alert_text(strike["distance_miles"])
        alert = {"alert_id": new_id("alt"), "site_id": site_id, "type": "stop_work_lightning",
                 "severity": "stop_work", "status": "active", "title": title, "message": message,
                 "started_at": now_iso(),
                 "stop_work_until": _iso(iso_now() + timedelta(seconds=STOP_WORK_SECONDS)),
                 "cleared_at": None, "acknowledged_by": [],
                 "evidence": [{"source": "goes-glm" if not strike["simulated"] else "simulated-strike",
                               "observed_at": strike["observed_at"]}],
                 "ledger_record_id": None, "simulated": strike["simulated"]}
        state["alerts"].append(alert)
        return make_event("stop_work_started", site_id, {
            "alert_id": alert["alert_id"], "strike_at": alert["started_at"],
            "distance_miles": strike["distance_miles"],
            "stop_work_until": alert["stop_work_until"]}, alert["simulated"])
    if alert["status"] == "active":  # extend: each new strike moves stop_work_until forward
        stop_until = _iso(iso_now() + timedelta(seconds=STOP_WORK_SECONDS))
        if stop_until > alert["stop_work_until"]:
            alert["stop_work_until"] = stop_until
            alert["evidence"].append({"source": "goes-glm" if not strike["simulated"] else "simulated-strike",
                                      "observed_at": strike["observed_at"]})
            return make_event("stop_work_extended", site_id, {
                "alert_id": alert["alert_id"], "strike_at": strike["observed_at"],
                "distance_miles": strike["distance_miles"],
                "stop_work_until": alert["stop_work_until"]}, alert["simulated"])
    return None


def _apply_action(state: dict, action: dict) -> dict | None:
    alert = next((a for a in state["alerts"] if a["alert_id"] == action.get("alert_id")), None)
    if alert is None:
        return None
    kind = action["action"]
    if kind == "acknowledge":
        entry = {"user_id": action["user_id"], "name": action.get("name", ""), "at": now_iso()}
        if not any(a["user_id"] == entry["user_id"] for a in alert["acknowledged_by"]):
            alert["acknowledged_by"].append(entry)
        return make_event("alert_acknowledged", alert["site_id"], {
            "alert_id": alert["alert_id"], "user_id": entry["user_id"], "name": entry["name"]}, alert["simulated"])
    if kind == "override" and alert["status"] == "active":
        alert["status"], alert["cleared_at"] = "overridden", now_iso()
        alert["overridden_by"] = {"user_id": action["user_id"], "name": action.get("name", ""), "at": now_iso()}
        return make_event("all_clear", alert["site_id"], {
            "alert_id": alert["alert_id"],
            "reason": f"Manual override by {action.get('name', action['user_id'])}"}, alert["simulated"])
    return None


def main() -> None:
    ap = argparse.ArgumentParser(description="Stop-work engine loop (writes stop_work.json + events.json).")
    ap.add_argument("--loop", type=float, default=5.0, help="seconds between ticks")
    ap.add_argument("--glm-poll", type=float, default=60.0,
                    help="seconds between GOES GLM ingest passes (0 = never; scheduler owns it instead)")
    ap.add_argument("--satellite", default="19", choices=["16", "18", "19"],
                    help="GOES-East is GOES-19; 16/18 kept for fallback/archive work")
    ap.add_argument("--once", action="store_true", help="one tick and exit")
    args = ap.parse_args()

    from cypress_workers.ingest import lightning_glm
    glm_last = 0.0
    step = 1
    while True:
        try:
            now = time.time()
            snap_age = 999999.0
            snap = read_json(LIGHTNING_FILE, {})
            if snap.get("fetched_at"):
                from datetime import datetime as dt, timezone as tz
                snap_age = (dt.now(tz.utc) - _ts(snap["fetched_at"])).total_seconds()
            if args.glm_poll > 0 and (now - glm_last >= args.glm_poll or snap_age > args.glm_poll):
                glm_last = now
                lightning_glm.poll(args.satellite)
            produced = tick()
            n_active = sum(1 for a in read_json(STOP_WORK_FILE, {}).get("alerts", []) if a["status"] == "active")
            print(f"[{now_iso()}] tick {step}: {len(produced)} event(s), {n_active} active alert(s)")
            for e in produced:
                print(f"  -> {e['type']} {e['site_id']} ({e['event_id']})")
        except Exception as e:  # a bad input file must not kill the engine
            print(f"  [error] {e}")
        step += 1
        if args.once:
            break
        time.sleep(args.loop)


if __name__ == "__main__":
    main()
