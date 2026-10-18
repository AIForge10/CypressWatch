"""Hazard index 0–10, model card, and Tiger Data insights (owner: M3).

GET /api/health                       -> {"ok": true}
GET /api/model                        -> ModelCard (written by backend/ml/src/cypress_ml/train.py)
GET /api/scores?day_offset=0          -> latest score for every site (today=0, tomorrow=1), ranked
GET /api/sites/{site_id}/insights     -> forecast drift + days like today + storm approach in one call
"""
import json

from fastapi import APIRouter, Query

from app.routers.common import MODEL_CARD, api_error, now_iso
from cypress_db import db, history, storm

router = APIRouter(prefix="/api", tags=["scores"])


@router.get("/health")
def health():
    return {"ok": True}


@router.get("/model")
def model_card():
    if not MODEL_CARD.exists():
        return api_error(503, "source_unavailable", "Model card not found. Run backend/ml/src/cypress_ml/train.py")
    return json.loads(MODEL_CARD.read_text())


@router.get("/scores")
def scores(day_offset: int = Query(0, ge=0, le=1)):
    rows = db.ranked_sites(day_offset=day_offset)
    return {"server_time": now_iso(), "day_offset": day_offset,
            "scores": [{k: r.get(k) for k in ("site_id", "name", "rank", "hazard_score", "risk_level", "top_hazard",
                                              "top_factors", "explanation", "model_version", "scored_at", "date")}
                       for r in rows]}


@router.get("/sites/{site_id}/insights")
def insights(site_id: str):
    if not db._site(site_id):
        return api_error(404, "not_found", f"Unknown site {site_id}")
    try:
        analogs = history.get_analogs(site_id)
    except Exception:  # noqa: BLE001
        analogs = None
    return {"site_id": site_id, "server_time": now_iso(), "forecast_drift": db.forecast_drift(site_id),
            "days_like_today": analogs, "storm_approach": storm.storm_approach(site_id),
            "stop_work": db.stop_work_status(site_id), "risk_trend_7d": db.risk_trend(site_id, 7)}
