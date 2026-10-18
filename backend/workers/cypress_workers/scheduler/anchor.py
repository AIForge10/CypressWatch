"""Anchor glue: the scheduler hands this the event log; it picks the window and calls merkle.

Window rule: from the previous anchor's period_end (or one hour ago) to the last whole hour,
so periods are stable ("hourly per-site Merkle roots" per ledger/README.md).
"""
import sys
from datetime import datetime, timedelta, timezone

from cypress_workers.common import EVENTS_FILE, LEDGER_ANCHORS_FILE, read_events, read_json

FMT = "%Y-%m-%dT%H:%M:%SZ"


def _merkle():
    ledger_src = EVENTS_FILE.parents[2].parent / "ledger"  # backend/workers/data/live/events.json -> backend
    if str(ledger_src) not in sys.path:
        sys.path.insert(0, str(ledger_src))
    import merkle
    return merkle


def anchor_period() -> dict:
    """Anchors everything that happened since the last anchor. Returns the merkle outcome."""
    merkle = _merkle()
    events = read_events()
    anchors = read_json(LEDGER_ANCHORS_FILE, {})

    last = anchors.get("anchors", [])
    if last:
        start = datetime.fromisoformat(last[-1]["period_end"].replace("Z", "+00:00"))
    else:
        start = (datetime.now(timezone.utc) - timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
    end = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    if end <= start:
        end = start + timedelta(hours=1)
    return merkle.anchor_period(events, start.strftime(FMT), end.strftime(FMT), LEDGER_ANCHORS_FILE)
