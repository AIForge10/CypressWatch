"""Shared helpers for the M3 routers (sites, scores, briefings).

Makes backend/db, backend/ledger and backend/ai importable, and returns errors in the contract's ApiError shape:
    {"error": "not_found", "message": "...", "request_id": "..."}
"""
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi.responses import JSONResponse

BACKEND = Path(__file__).resolve().parents[3]          # backend/
for sub in ("db", "ledger", "ai"):
    p = str(BACKEND / sub)
    if p not in sys.path:
        sys.path.insert(0, p)

MODEL_CARD = BACKEND / "ml" / "reports" / "model_card.json"


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def api_error(status: int, error: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status,
                        content={"error": error, "message": message, "request_id": f"req_{uuid.uuid4().hex[:10]}"})
