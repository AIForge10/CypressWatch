"""Alerts: read stop-work state, acknowledge, override (owner: M4 per docs/api-contract.md).

The engine (workers/cypress_workers/engines/lightning.py) is the only writer of alert state;
this router *queues* actions (backend/workers/data/live/alert_actions.json) that the engine
consumes within ~5 s and then emits the contract event (alert_acknowledged / all_clear).

Identity: M1 owns Auth0 (app/auth). Until then users arrive via headers:
  X-User-Id   "auth0|crew_014"   (required for ack/override)
  X-User-Name "Jake Turner"     (optional)
Step-up MFA for override: once M1 wires it, verify the token claim here; until then the
frontend must send X-MFA-Verified: true, or we return 401 step_up_required per contract.
"""
from fastapi import APIRouter, Header, HTTPException
from pathlib import Path
import sys

from cypress_workers.common import (ALERT_ACTIONS_FILE, LEDGER_ANCHORS_FILE, STOP_WORK_FILE, now_iso,
                                    read_json, write_json)

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


def _ledger_src() -> Path:  # ledger/merkle for record lookup
    here = Path(__file__).resolve()
    backend = here.parents[3]
    src = backend / "ledger"
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))
    return src


def _ledger_record_for(alert_id: str) -> str | None:
    src = _ledger_src()
    from merkle import verify_record  # noqa: F401  (import ok; lookups use the file)
    anchors = read_json(LEDGER_ANCHORS_FILE, {})
    for record_id, rec in anchors.get("records", {}).items():
        if rec.get("payload", {}).get("alert_id") == alert_id:
            return record_id
    return None


def _identity(user_id: str | None, name: str | None) -> dict:
    if not user_id:
        raise HTTPException(status_code=401, detail={"error": "unauthorized",
                                                     "message": "Missing X-User-Id (Auth0 comes with M1)."})
    return {"user_id": user_id, "name": name or ""}


@router.get("")
def list_alerts(status: str | None = None, site_id: str | None = None):
    state = read_json(STOP_WORK_FILE, {"alerts": []})
    alerts = [a for a in state.get("alerts", [])
              if (status is None or a["status"] == status)
              and (site_id is None or a["site_id"] == site_id)]
    for a in alerts:
        a.setdefault("ledger_record_id")
        if not a.get("ledger_record_id"):
            a["ledger_record_id"] = _ledger_record_for(a["alert_id"])
    return {"server_time": state.get("server_time", now_iso()), "alerts": alerts}


@router.post("/{alert_id}/acknowledge")
def acknowledge(alert_id: str, x_user_id: str | None = Header(default=None), x_user_name: str | None = Header(default=None)):
    who = _identity(x_user_id, x_user_name)
    state = read_json(STOP_WORK_FILE, {"alerts": []})
    if not any(a["alert_id"] == alert_id for a in state.get("alerts", [])):
        raise HTTPException(status_code=404, detail={"error": "not_found",
                                                     "message": f"Alert {alert_id} does not exist."})
    _queue_action({"action": "acknowledge", "alert_id": alert_id, **who})
    return {"alert_id": alert_id,
            "acknowledged_by": {"user_id": who["user_id"], "name": who["name"], "at": now_iso()},
            "ledger_record_id": _ledger_record_for(alert_id)}


@router.post("/{alert_id}/override")
def override(alert_id: str, x_user_id: str | None = Header(default=None), x_user_name: str | None = Header(default=None),
             x_mfa_verified: str | None = Header(default=None)):
    who = _identity(x_user_id, x_user_name)
    if not (x_mfa_verified or "").lower() == "true":
        raise HTTPException(status_code=401, detail={"error": "step_up_required",
                                                     "message": "Re-authenticate with step-up MFA to override a stop-work."})
    state = read_json(STOP_WORK_FILE, {"alerts": []})
    alert = next((a for a in state.get("alerts", []) if a["alert_id"] == alert_id), None)
    if alert is None:
        raise HTTPException(status_code=404, detail={"error": "not_found",
                                                     "message": f"Alert {alert_id} does not exist."})
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
