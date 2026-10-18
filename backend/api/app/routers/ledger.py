"""Solana Safety Ledger: record verification (owner: M3). GET returns the ledger_verify.json shape."""
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/ledger", tags=["ledger"])


def _verify(record_id: str):
    here = Path(__file__).resolve()          # backend/api/app/routers/ledger.py
    backend = here.parents[3]                # -> backend
    anchors = backend / "workers" / "data" / "live" / "ledger_anchors.json"
    src = backend / "ledger"                 # ledger/merkle package
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))
    import merkle
    return merkle.verify_record(record_id, anchors)


@router.get("/verify/{record_id}")
def verify(record_id: str):
    outcome = _verify(record_id)
    if outcome is None:
        raise HTTPException(status_code=404, detail={
            "error": "not_found",
            "message": f"Record {record_id} has not been anchored (yet). "
                       f"Ask the scheduler to run, then check the record id in the event log."})
    return outcome
