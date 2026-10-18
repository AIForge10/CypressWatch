"""Alerts: read stop-work state, acknowledge, override (owner: M4 per docs/api-contract.md).

The engine (workers/cypress_workers/engines/lightning.py) is the only writer of alert state;
this router *queues* actions (backend/workers/data/live/alert_actions.json) that the engine
consumes within ~5 s and then emits the contract event (alert_acknowledged / all_clear).

Identity, roles, site assignments, and step-up MFA are derived only from an
Auth0-signed Bearer access token. Client-provided identity or MFA headers are
never trusted.
"""
from fastapi import APIRouter, Depends, HTTPException
from pathlib import Path
import sqlite3
import sys

from app.auth import AuthenticatedUser, get_current_user, require_roles, require_site_access
from cypress_workers.common import ALERT_ACTIONS_FILE, STOP_WORK_FILE, now_iso, read_json, write_json

router = APIRouter(prefix="/api/alerts", tags=["alerts"])

LEDGER_DB = Path(__file__).resolve().parents[3] / "ledger" / "data" / "ledger.db"


def _ledger_record_for(alert_id: str) -> str | None:
    """The ledger_record_id of the first stored record that mentions this alert (rec_..)."""
    if not LEDGER_DB.exists():
        return None
    with sqlite3.connect(LEDGER_DB) as db:
        hit = db.execute("SELECT record_id FROM records WHERE payload LIKE ? ORDER BY created_at LIMIT 1",
                         (f'%"alert_id":"{alert_id}"%',)).fetchone()
    return hit[0] if hit else None


def _identity(user: AuthenticatedUser) -> dict:
    return {"user_id": user.user_id, "name": user.name}


@router.get("")
def list_alerts(status: str | None = None, site_id: str | None = None,
                user: AuthenticatedUser = Depends(get_current_user)):
    if site_id:
        require_site_access(user, site_id)
    state = read_json(STOP_WORK_FILE, {"alerts": []})
    alerts = [a for a in state.get("alerts", [])
              if (status is None or a["status"] == status)
              and (site_id is None or a["site_id"] == site_id)
              and user.can_access_site(a["site_id"])]
    for a in alerts:
        a.setdefault("ledger_record_id")
        if not a.get("ledger_record_id"):
            a["ledger_record_id"] = _ledger_record_for(a["alert_id"])
    return {"server_time": state.get("server_time", now_iso()), "alerts": alerts}


@router.post("/{alert_id}/acknowledge")
def acknowledge(alert_id: str, user: AuthenticatedUser = Depends(require_roles("crew", "supervisor"))):
    who = _identity(user)
    state = read_json(STOP_WORK_FILE, {"alerts": []})
    alert = next((a for a in state.get("alerts", []) if a["alert_id"] == alert_id), None)
    if alert is None:
        raise HTTPException(status_code=404, detail={"error": "not_found",
                                                     "message": f"Alert {alert_id} does not exist."})
    require_site_access(user, alert["site_id"])
    _queue_action({"action": "acknowledge", "alert_id": alert_id, **who})
    return {"alert_id": alert_id,
            "acknowledged_by": {"user_id": who["user_id"], "name": who["name"], "at": now_iso()},
            "ledger_record_id": _ledger_record_for(alert_id)}


@router.post("/{alert_id}/override")
def override(alert_id: str, user: AuthenticatedUser = Depends(require_roles("supervisor"))):
    who = _identity(user)
    if not user.has_fresh_mfa:
        raise HTTPException(status_code=401, detail={"error": "step_up_required",
                                                     "message": "A fresh MFA-verified access token is required to override a stop-work."})
    state = read_json(STOP_WORK_FILE, {"alerts": []})
    alert = next((a for a in state.get("alerts", []) if a["alert_id"] == alert_id), None)
    if alert is None:
        raise HTTPException(status_code=404, detail={"error": "not_found",
                                                     "message": f"Alert {alert_id} does not exist."})
    require_site_access(user, alert["site_id"])
    if alert["status"] != "active":
        raise HTTPException(status_code=409, detail={"error": "bad_request",
                                                     "message": f"Alert {alert_id} is {alert['status']}, not active."})
    _queue_action({"action": "override", "alert_id": alert_id, **who})
    return {"alert_id": alert_id, "status": "overridden",
            "overridden_by": {"user_id": who["user_id"], "name": who["name"], "at": now_iso()},
            "mfa_verified": True,
            "ledger_record_id": _ledger_record_for(alert_id)}


def _queue_action(action: dict) -> None:
    pending = read_json(ALERT_ACTIONS_FILE, [])
    pending.append(action)
    write_json(ALERT_ACTIONS_FILE, pending)
