"""Stop-work / all-clear / flood alerts and overrides (owner: M4)."""

from fastapi import APIRouter

router = APIRouter(prefix="/alerts", tags=["alerts"])
