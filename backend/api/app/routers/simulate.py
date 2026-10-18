"""Demo injection: simulate strike (owner: M4). Feeds the REAL stop-work engine.

POST /api/demo/strike with DemoStrikeRequest {site_id, distance_miles?, bearing_deg?} puts a
simulated strike (distance_miles defaults to 4.2, always < 10, contract rule) into the strikes
queue; the engine's next ~5 s tick starts/extends the stop-work and emits
stop_work_started/stop_work_extended with simulated:true. Every response is flagged simulated.
"""
from fastapi import APIRouter, HTTPException

from cypress_workers.common import (LIGHTNING_FILE, SITES_FILE, STRIKES_QUEUE_FILE, load_sites, now_iso,
                                    read_json, write_json)

router = APIRouter(prefix="/api/demo", tags=["demo"])


@router.post("/strike")
def strike(request: dict):
    if not (site_id := request.get("site_id")) or site_id not in load_sites():
        raise HTTPException(status_code=404, detail={"error": "not_found",
                                                     "message": f"Site {site_id} does not exist."})
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
