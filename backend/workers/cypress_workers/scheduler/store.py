"""Small save/load helpers for the scheduler: scores snapshot + previous-score memory.

The score_updated event fires only when a site's TODAY score actually changed, so the
supervisor dashboard does not flood with duplicate events every 15 minutes.
"""
from cypress_workers.common import (LIVE, SCORES_FILE, append_events, make_event, now_iso, read_json,
                                    write_json)

PREV_JSON = LIVE / "scores_previous.json"


def read_scores() -> dict:
    return read_json(SCORES_FILE, {"scores": []})


def save_scores(scores: list[dict]) -> dict:
    previous = {s["site_id"]: s.get("hazard_score") for s in read_scores()["scores"] if s.get("day_offset") == 0}
    snapshot = {"scored_at": now_iso(), "count": len(scores), "scores": scores}
    write_json(SCORES_FILE, snapshot)
    return {"previous": previous, "snapshot": snapshot}


def score_updated_events(scores: list[dict], previous: dict[str, float]) -> list[dict]:
    """One score_updated event per site whose today score moved since the last refresh."""
    events = []
    for s in scores:
        if s.get("day_offset") == 0 and previous.get(s["site_id"]) is not None \
                and round(s["hazard_score"], 1) != round(previous[s["site_id"]], 1):
            events.append(make_event("score_updated", s["site_id"], {
                "hazard_score": s["hazard_score"], "risk_level": s["risk_level"],
                "previous_score": previous[s["site_id"]]}))
    return events


def remember_previous(scores: list[dict]) -> None:
    prev = {s["site_id"]: s.get("hazard_score") for s in scores if s.get("day_offset") == 0}
    write_json(PREV_JSON, {"updated_at": now_iso(), "scores": prev})
