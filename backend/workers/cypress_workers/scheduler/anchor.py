"""Anchor glue: the scheduler hands this the event log; it feeds the Solana Safety Ledger.

Every safety event (stop-work, all-clear, ack, override, report) becomes an immutable local
record ("rec_..", see backend/ledger/cypress_ledger/ledger.py) whose Merkle root is written
to Solana devnet hourly. A cursor file (ledger_cursor.json) makes this idempotent: replaying
the same events twice never produces duplicate records.
"""
import sys
import sqlite3

from pathlib import Path

from cypress_workers.common import EVENTS_FILE, LIVE, now_iso, read_events, read_json, write_json

RECORD_FOR_EVENT = {  # event type -> (record_type, payload keys we keep)
    "stop_work_started": ("stop_work", "alert_id", "strike_at", "distance_miles", "stop_work_until"),
    "stop_work_extended": ("stop_work", "alert_id", "strike_at", "distance_miles", "stop_work_until"),
    "all_clear": ("all_clear", "alert_id", "reason"),
    "override": ("override", "alert_id", "user_id", "name", "reason", "mfa_verified"),
    "alert_acknowledged": ("acknowledgment", "alert_id", "user_id", "name"),
    "report_created": ("crew_report", "report_id", "hazard", "severity", "status"),
}

CURSOR_FILE = LIVE / "ledger_cursor.json"
LEDGER_SRC = EVENTS_FILE.parents[2].parent / "ledger"  # backend


def _ledger():
    if str(LEDGER_SRC) not in sys.path:
        sys.path.insert(0, str(LEDGER_SRC))
    from cypress_ledger.ledger import Ledger
    return Ledger()


def _already_recorded(ledger, event: dict) -> bool:
    with sqlite3.connect(ledger.db_file) as db:
        hit = db.execute("SELECT 1 FROM records WHERE payload LIKE ? LIMIT 1",
                         (f'%"event_id":"{event["event_id"]}"%',)).fetchone()
    return hit is not None


def anchor_period() -> dict:
    """Record the event log's unprocessed safety events and anchor the pending ones."""
    ledger = _ledger()
    events = read_events()
    cursor = read_json(CURSOR_FILE, {})
    stop = cursor.get("last_event_id")
    idx = next((i for i, e in enumerate(events) if e["event_id"] == stop), None)
    todo = events[0:] if idx is None else events[idx + 1:]
    recorded = []
    for e in todo:
        mapping = RECORD_FOR_EVENT.get(e["type"])
        if not mapping:
            continue
        record_type, *keys = mapping
        payload = {k: e["data"][k] for k in keys if k in e["data"]}
        if "user_id" in payload and payload["user_id"] is None:
            payload["user_id"] = "unknown"
        payload["event_id"] = e["event_id"]
        if _already_recorded(ledger, e):
            continue
        ledger.record(record_type, e["site_id"] or "unknown", payload, created_at=e["occurred_at"])
        recorded.append(e["event_id"])
    got = ledger.anchor()
    if todo:  # records are persisted even when the memo send fails; the next run retries the batch
        write_json(CURSOR_FILE, {"last_event_id": todo[-1]["event_id"], "updated_at": now_iso()})
    verifiable = [r[0] for r in sqlite3.connect(ledger.db_file).execute(
        "SELECT record_id FROM records WHERE batch_id IS NOT NULL").fetchall()]
    return {"recorded": len(recorded), "anchored": bool(got and got.get("transaction_signature")),
            "batch": None if not got else {k: got.get(k) for k in
                                           ("batch_id", "merkle_root", "transaction_signature", "error")},
            "sample_record": verifiable[-1] if verifiable else None}
