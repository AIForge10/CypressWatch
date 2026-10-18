"""Solana Safety Ledger: record verification. GET returns the ledger_verify.json shape."""
import sqlite3
import sys
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from app.auth import AuthenticatedUser, require_roles, require_site_access

router = APIRouter(prefix="/api/ledger", tags=["ledger"])


def _ledger():
    here = Path(__file__).resolve()
    backend = here.parents[3]
    if str(backend / "ledger") not in sys.path:
        sys.path.insert(0, str(backend / "ledger"))
    from cypress_ledger.ledger import Ledger
    return Ledger()


def _record_site(record_id: str) -> str | None:
    ledger = _ledger()
    with sqlite3.connect(ledger.db_file) as db:
        row = db.execute("SELECT site_id FROM records WHERE record_id = ?", (record_id,)).fetchone()
    return row[0] if row else None


def _verify(record_id: str):
    here = Path(__file__).resolve()          # backend/api/app/routers/ledger.py
    backend = here.parents[3]                # -> backend
    src = backend / "ledger"                 # cypress_ledger package
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))
    from cypress_ledger.ledger import Ledger
    try:
        return Ledger().verify(record_id)
    except KeyError:
        return None


@router.get("/verify/{record_id}")
def verify(record_id: str, user: AuthenticatedUser = Depends(require_roles("supervisor", "owner"))):
    site_id = _record_site(record_id)
    if site_id is None:
        raise HTTPException(status_code=404, detail={
            "error": "not_found",
            "message": f"Record {record_id} does not exist. "
                       f"Check the record id in the event log (or run ledger.py status)."})
    require_site_access(user, site_id)
    outcome = _verify(record_id)
    if outcome is None:
        raise HTTPException(status_code=404, detail={
            "error": "not_found",
            "message": f"Record {record_id} does not exist. "
                       f"Check the record id in the event log (or run ledger.py status)."})
    return outcome


@router.get("/records")
def records(user: AuthenticatedUser = Depends(require_roles("supervisor", "owner"))) -> dict:
    """Recent ledger records with anchoring status, newest first (for the Verify page)."""
    ledger = _ledger()
    with sqlite3.connect(ledger.db_file) as db:
        db.row_factory = sqlite3.Row
        rows = db.execute(
            "SELECT r.record_id, r.record_type, r.site_id, r.created_at, b.merkle_root, "
            "       b.transaction_signature FROM records r LEFT JOIN batches b ON r.batch_id = b.batch_id "
            "ORDER BY r.created_at DESC, r.record_id DESC LIMIT 50").fetchall()
    return {"server_time": None, "records": [
        {"record_id": r["record_id"], "record_type": r["record_type"], "site_id": r["site_id"],
         "created_at": r["created_at"], "anchored": bool(r["transaction_signature"]),
         "merkle_root": r["merkle_root"], "transaction_signature": r["transaction_signature"]}
        for r in rows if user.can_access_site(r["site_id"])]}
