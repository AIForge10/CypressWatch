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
# =============================================================================================
# Contract endpoints (owner: M3) — ADDED below M4's /summary. Nothing above this line changed.
#   GET /api/sites                    -> SitesResponse
#   GET /api/sites/{site_id}          -> SiteDetail (+ days_like_today, storm_approach)
#   GET /api/sites/{site_id}/history  -> SiteHistory
# =============================================================================================
import re  # noqa: E402

from fastapi import Query  # noqa: E402

from app.routers.common import api_error  # noqa: E402
from cypress_db import db, history, storm  # noqa: E402

RISK_CUTS = [(8, "extreme"), (6, "high"), (4, "moderate"), (0, "low")]
STOP_WORK_FLOOR = 9.0
SITE_FIELDS = ("site_id", "name", "eia_plant_id", "plant_type", "county", "state", "lat", "lon", "timezone")
NO_STOP = {"active": False, "reason": None, "last_strike_at": None, "stop_work_until": None,
           "strikes_last_30_min": 0, "nearest_strike_miles": None}
LEVEL_SCORE = {"low": 2.0, "moderate": 5.0, "high": 7.0, "extreme": 9.0}


def _risk(score: float) -> str:
    return next(level for cut, level in RISK_CUTS if score >= cut)


def _alerts_by_site() -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for a in read_json(STOP_WORK_FILE, {"alerts": []}).get("alerts", []):
        if a.get("status") == "active":
            out.setdefault(a["site_id"], []).append(a)
    return out


def _stop_work(alerts: list[dict]) -> dict:
    a = next((x for x in alerts if x.get("severity") == "stop_work" or str(x.get("type", "")).startswith("stop_work")),
             None)
    if not a:
        return NO_STOP
    miles = re.search(r"([\d.]+)\s*mi", a.get("title", ""))
    last = None
    if a.get("stop_work_until"):
        until = datetime.fromisoformat(a["stop_work_until"].replace("Z", "+00:00"))
        last = (until - db.timedelta(minutes=db.STOP_WORK_MINUTES)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {"active": True, "reason": "lightning", "last_strike_at": a.get("last_strike_at") or last,
            "stop_work_until": a.get("stop_work_until"),
            "strikes_last_30_min": int(a.get("strikes_last_30_min") or 1),
            "nearest_strike_miles": a.get("nearest_strike_miles") or (float(miles.group(1)) if miles else None)}


def _score_rows() -> list[dict]:
    try:
        return db.ranked_sites()
    except Exception:  # noqa: BLE001
        scores = {s["site_id"]: s for s in read_json(LIVE / "scores_latest.json", {}).get("scores", [])
                  if s.get("day_offset") == 0}
        rows = []
        for site in read_json(SITES_FILE, {}).get("sites", []):
            sc = scores.get(site["site_id"], {})
            rows.append({**site, **{k: sc.get(k) for k in ("hazard_score", "risk_level", "top_factors",
                                                          "explanation", "model_version", "scored_at")},
                         "top_hazard": db.top_hazard(sc.get("top_factors"))})
        return rows


def _site_summaries() -> tuple[list[dict], str | None]:
    alerts = _alerts_by_site()
    try:
        reports = db.open_report_counts()
    except Exception:  # noqa: BLE001
        reports = {}
    out, model_version = [], None
    for r in _score_rows():
        site_alerts = alerts.get(r["site_id"], [])
        sw = _stop_work(site_alerts)
        score, top = r.get("hazard_score"), r.get("top_hazard")
        if sw["active"]:
            score, top = max(score or 0, STOP_WORK_FLOOR), "lightning"
        model_version = model_version or r.get("model_version")
        out.append({**{k: r.get(k) for k in SITE_FIELDS},
                    "eia_plant_id": str(r["eia_plant_id"]) if r.get("eia_plant_id") is not None else None,
                    "hazard_score": round(score, 1) if score is not None else None,
                    "risk_level": _risk(score) if score is not None else None,
                    "rank": 0, "top_hazard": top or "storm", "stop_work": sw,
                    "active_alert_count": len(site_alerts), "open_report_count": reports.get(r["site_id"], 0),
                    "updated_at": r.get("scored_at"), "data_freshness": _freshness(r.get("scored_at"))})
    out.sort(key=lambda s: -(s["hazard_score"] if s["hazard_score"] is not None else -1))
    for i, s in enumerate(out, 1):
        s["rank"] = i
    return out, model_version


@router.get("")
def list_sites() -> dict:
    sites, model_version = _site_summaries()
    return {"server_time": now_iso(), "model_version": model_version or "hazard_index_v1", "sites": sites}


def _level(value, cuts) -> str:
    level = "low"
    for cut, name in cuts:
        if value is not None and value >= cut:
            level = name
    return level


def _hazards(cond: dict | None, sw: dict, approach: dict) -> list[dict]:
    if sw["active"]:
        lvl = "extreme"
        summary = f"Stop work: lightning {sw['nearest_strike_miles'] or ''} mi away. Wait for the all-clear countdown."
        value = sw["nearest_strike_miles"]
    elif approach.get("approaching"):
        lvl, summary, value = "high", approach["summary"], approach["nearest_miles"]
    elif approach.get("strikes"):
        lvl, summary, value = "moderate", approach["summary"], approach["nearest_miles"]
    else:
        lvl, summary, value = "low", "No lightning within 40 miles in the last 30 minutes.", None
    out = [{"hazard": "lightning", "level": lvl, "score": LEVEL_SCORE[lvl], "summary": summary, "value": value,
            "unit": "miles" if value is not None else None, "source": "goes-glm",
            "observed_at": approach.get("checked_at") or now_iso()}]
    if cond:
        for hazard, key, unit, cuts, label in (
                ("heat", "heat_index_f", "°F", [(90, "moderate"), (103, "high"), (125, "extreme")], "Heat index {v}°F"),
                ("storm", "wind_gust_mph", "mph", [(25, "moderate"), (40, "high"), (58, "extreme")], "Wind gusts {v} mph")):
            v = cond.get(key)
            if v is not None:
                lvl = _level(v, cuts)
                out.append({"hazard": hazard, "level": lvl, "score": LEVEL_SCORE[lvl],
                            "summary": label.format(v=round(v)), "value": round(v), "unit": unit,
                            "source": cond["source"], "observed_at": cond["observed_at"]})
    order = {"extreme": 0, "high": 1, "moderate": 2, "low": 3}
    return sorted(out, key=lambda h: order[h["level"]])


def _safe(fn, *args, default=None):
    try:
        return fn(*args)
    except Exception:  # noqa: BLE001
        return default


@router.get("/{site_id}")
def site_detail(site_id: str):
    sites, _ = _site_summaries()
    site = next((s for s in sites if s["site_id"] == site_id), None)
    if not site:
        return api_error(404, "not_found", f"Unknown site {site_id}")
    score = _safe(db.site_score, site_id)
    cond = _safe(db.latest_conditions, site_id)
    approach = _safe(storm.storm_approach, site_id, default={})
    briefing = _safe(db.get_briefing, site_id, None, "en")
    score_block = None
    if score or site.get("hazard_score") is not None:
        score = score or {}
        score_block = {"hazard_score": site["hazard_score"], "risk_level": site["risk_level"],
                       "model_version": score.get("model_version", "hazard_index_v1"),
                       "scored_at": score.get("scored_at") or site.get("updated_at"),
                       "top_factors": [{k: f.get(k) for k in ("feature", "label", "contribution")}
                                       for f in score.get("top_factors") or []],
                       "explanation": score.get("explanation")}
    conditions = None if not cond else {
        "temperature_f": cond["temperature_f"], "heat_index_f": cond["heat_index_f"],
        "humidity_pct": cond["humidity_pct"], "wind_gust_mph": cond["wind_gust_mph"],
        "rain_24h_in": None, "rain_overnight_in": None, "soil_moisture_pct": None,
        "source": cond["source"], "observed_at": cond["observed_at"]}
    return {
        "server_time": now_iso(),
        "site": {**site, "flood_zone": None, "river_site": False, "distance_to_river_miles": None},
        "score": score_block,
        "hazards": _hazards(cond, site["stop_work"], approach or {}),
        "conditions": conditions,
        "forecast_drift": _safe(db.forecast_drift, site_id),
        "best_work_window": (briefing or {}).get("best_work_window"),
        "active_alerts": _alerts_by_site().get(site_id, []),
        "recent_reports": _safe(db.site_reports, site_id, 10, default=[]),
        "days_like_today": _safe(history.get_analogs, site_id),
        "storm_approach": approach or None,
    }


@router.get("/{site_id}/history")
def site_history(site_id: str, hours: int = Query(48, ge=1, le=168)):
    if not _safe(db._site, site_id):
        return api_error(404, "not_found", f"Unknown site {site_id}")
    return db.site_history(site_id, hours)
