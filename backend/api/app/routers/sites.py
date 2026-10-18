"""Sites summary for the supervisor overview (owner: M4): sites.json + live scores + stop-works
in one request, so the dashboard does not stitch three files together in the browser."""
from datetime import datetime, timezone

from fastapi import APIRouter

from cypress_workers.common import LIVE, SITES_FILE, STOP_WORK_FILE, now_iso, read_json

router = APIRouter(prefix="/api/sites", tags=["sites"])

FRESH_WINDOW = 60 * 60  # scores older than 1 h are marked Stale for the freshness badge


def _freshness(scored_at: str | None) -> str:
    if not scored_at:
        return "Unavailable"
    try:
        age = datetime.now(timezone.utc) - datetime.fromisoformat(scored_at.replace("Z", "+00:00"))
    except ValueError:
        return "Unavailable"
    return "Fresh" if age.total_seconds() < FRESH_WINDOW else "Stale"


@router.get("/summary")
def summary() -> dict:
    by_site = {s["site_id"]: s for s in
               read_json(LIVE / "scores_latest.json", {}).get("scores", []) if s.get("day_offset") == 0}
    alerts = [a for a in read_json(STOP_WORK_FILE, {"alerts": []}).get("alerts", [])
              if a.get("status") == "active"]
    alert_by_site = {a["site_id"]: a for a in alerts}
    out = []
    for site in read_json(SITES_FILE, {}).get("sites", []):
        score = by_site.get(site["site_id"], {})
        alert = alert_by_site.get(site["site_id"])
        out.append({
            "site_id": site["site_id"], "name": site["name"],
            "location": f"{site['county']} County, {site['state']}",
            "lat": site["lat"], "lon": site["lon"], "timezone": site["timezone"],
            "hazard_score": score.get("hazard_score"),
            "risk_level": score.get("risk_level"),
            "top_factors": score.get("top_factors", []),
            "scored_at": score.get("scored_at"),
            "data_freshness": _freshness(score.get("scored_at")),
            "stop_work": None if not alert else {
                "alert_id": alert["alert_id"], "reason": alert["title"],
                "started_at": alert["started_at"], "stop_work_until": alert["stop_work_until"],
                "acknowledged": bool(alert.get("acknowledged_by"))},
        })
    return {"server_time": now_iso(), "sites": out}
