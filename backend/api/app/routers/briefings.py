"""6 PM next-day briefings (EN/ES) (owner: M3).

GET /api/sites/{site_id}/briefing?date=YYYY-MM-DD&lang=en -> Briefing (contracts/mocks/briefing.json)
    date omitted -> the latest briefing for the site.
"""
from datetime import date as Date

from fastapi import APIRouter, Query

from app.routers.common import api_error
from cypress_db import db

router = APIRouter(prefix="/api", tags=["briefings"])


@router.get("/sites/{site_id}/briefing")
def get_briefing(site_id: str, date: Date | None = Query(None), lang: str = Query("en", pattern="^(en|es)$")):
    body = db.get_briefing(site_id, date.isoformat() if date else None, lang)
    if body is None:
        return api_error(404, "not_found",
                         f"No {lang} briefing for {site_id}" + (f" on {date.isoformat()}" if date else ""))
    return body
