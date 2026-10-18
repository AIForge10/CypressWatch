"""Demo injection: simulate strike + heavy-rain night (owner: M4). Feeds the REAL engines.

POST /api/demo/strike with DemoStrikeRequest {site_id, distance_miles?, bearing_deg?} puts a
simulated strike (distance_miles defaults to 4.2, always < 10, contract rule) into the strikes
queue; the engine's next ~5 s tick starts/extends the stop-work and emits
stop_work_started/stop_work_extended with simulated:true. Every response is flagged simulated.

POST /api/demo/flood-rain with DemoHeavyRainRequest {site_id, overnight_in?} queues a simulated
heavy-rain night into flood_queue.json; the engine applies it on its next flood tick (<= ~2 min,
immediately when the queue file exists) and, on river-relevant sites, raises a flood_risk alert +
flood_alert_started. River-relevant = river_site flag / non-X FEMA zone / near a USGS gauge —
the response lists those sites so the demo operator picks one that will actually warn.
"""
from fastapi import APIRouter, Depends, HTTPException

from app.auth import AuthenticatedUser, require_roles, require_site_access
from cypress_workers.common import (LIGHTNING_FILE, SITES_FILE, STRIKES_QUEUE_FILE, load_sites,
                                    now_iso, read_json, write_json)

router = APIRouter(prefix="/api/demo", tags=["demo"])


@router.post("/strike")
def strike(request: dict, user: AuthenticatedUser = Depends(require_roles("supervisor"))):
    if not (site_id := request.get("site_id")) or site_id not in load_sites():
        raise HTTPException(status_code=404, detail={"error": "not_found",
                                                     "message": f"Site {site_id} does not exist."})
    require_site_access(user, site_id)
    distance = round(float(request.get("distance_miles", 4.2)), 1) or 4.2
    strike_in = {
        "site_id": site_id,
        "distance_miles": min(max(distance, 0.5), 9.5),  # inside the 10-mile rule
        "bearing_deg": float(request.get("bearing_deg", 250)),
        "strike_at": now_iso(),
        "simulated": True,
    }
    queue = read_json(STRIKES_QUEUE_FILE, [])
    queue.append(strike_in)
    write_json(STRIKES_QUEUE_FILE, queue)
    return {"accepted": True, "queued_strike": strike_in, "simulated": True,
            "note": "The engine applies it on its next tick (~5 s)."}


@router.post("/flood-rain")
def heavy_rain(request: dict, user: AuthenticatedUser = Depends(require_roles("supervisor"))):
    site_id = request.get("site_id")
    sites = load_sites()
    if not site_id or site_id not in sites:
        raise HTTPException(status_code=404, detail={"error": "not_found",
                                                     "message": f"Site {site_id} does not exist."})
    require_site_access(user, site_id)
    overnight = min(max(float(request.get("overnight_in", 4.5) or 4.5), 0.1), 20.0)
    from cypress_workers.engines.flood import river_relevant_sites, simulate_rain
    queued = simulate_rain(site_id, overnight)
    relevant = river_relevant_sites()
    return {"accepted": True, "queued_rain": queued, "simulated": True,
            "flood_alert_expected": site_id in {s["site_id"] for s in relevant},
            "river_sites": relevant,
            "note": "The flood rule applies it on the next flood tick (<= ~2 min, now if one ran); "
                    "only river-relevant sites raise the flood_risk alert."}
