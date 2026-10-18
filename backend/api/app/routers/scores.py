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

# =============================================================================================
# Tiger Data proof panel (owner: M3):  GET /api/tiger
# Live from Tiger Cloud: hypertables, chunks, compression savings, continuous aggregates,
# background jobs (refresh / compression / retention) and extensions.
# =============================================================================================
TIGER_SQL = {
    "extensions": """
        SELECT extname AS name, extversion AS version FROM pg_extension
        WHERE extname IN ('timescaledb', 'vector', 'vectorscale') ORDER BY 1""",
    "hypertables": """
        SELECT h.hypertable_name AS name, h.num_chunks AS chunks, h.compression_enabled AS compression,
               pg_size_pretty(hypertable_size(format('%I.%I', h.hypertable_schema, h.hypertable_name)::regclass)) AS size
        FROM timescaledb_information.hypertables h ORDER BY 1""",
    "compression": """
        SELECT h.hypertable_name AS name,
               pg_size_pretty(s.before_compression_total_bytes) AS before,
               pg_size_pretty(s.after_compression_total_bytes) AS after,
               round(100 * (1 - s.after_compression_total_bytes::numeric
                                / nullif(s.before_compression_total_bytes, 0)), 1) AS saved_pct
        FROM timescaledb_information.hypertables h,
             LATERAL hypertable_compression_stats(format('%I.%I', h.hypertable_schema, h.hypertable_name)::regclass) s
        WHERE s.before_compression_total_bytes IS NOT NULL ORDER BY 1""",
    "continuous_aggregates": """
        SELECT view_name AS name, materialized_only FROM timescaledb_information.continuous_aggregates ORDER BY 1""",
    "jobs": """
        SELECT j.application_name AS job, j.hypertable_name AS target, j.schedule_interval::text AS every,
               s.last_run_status AS status, s.last_successful_finish AS last_ok, s.total_runs AS runs
        FROM timescaledb_information.jobs j
        LEFT JOIN timescaledb_information.job_stats s ON s.job_id = j.job_id
        WHERE j.job_id >= 1000 ORDER BY 2, 1""",
}


@router.get("/tiger")
def tiger_stats():
    out = {"server_time": now_iso(), "database": "Tiger Data (TimescaleDB + pgvector)"}
    for key, sql in TIGER_SQL.items():
        try:  # separate connection per query: one failure never breaks the panel
            with db.conn() as c:
                out[key] = c.execute(sql).fetchall()
        except Exception as e:  # noqa: BLE001
            out[key] = {"error": str(e).splitlines()[0]}
    return out