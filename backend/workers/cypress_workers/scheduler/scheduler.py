"""Vultr scheduler (M4): drives the pipeline on a clock, per docs/architecture.md.

Heavy chain, every WEATHER_INTERVAL seconds:
    weather_live.run() -> score_sites(stop-work set) -> explain_scores() -> save JSON
    A score change appends a `score_updated` event (the engine alone starts stop-works).

Ledger, every ANCHOR_HOURS: Merkle root of the window's records -> devnet (see anchor.py).

Briefings, every BRIEF_SCAN_SECONDS: each site's LOCAL 18:00 triggers its next-day briefing
(America/New_York vs America/Chicago differ, so every site is scanned individually).

Run (separate process from the stop-work engine):
    cd backend/workers && python -m cypress_workers.scheduler.scheduler
"""
import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from cypress_workers.common import (BACKEND_DIR, LIVE, STOP_WORK_FILE, WEATHER_FILE, append_events, load_sites,
                                    make_event, now_iso, read_json, write_json)
from cypress_workers.ingest import weather_live
from cypress_workers.scheduler import store

# score_sites / generate_briefing need backend/ml/src and backend/ai importable
sys.path.insert(0, str(BACKEND_DIR / "ml" / "src"))
sys.path.insert(0, str(BACKEND_DIR / "ai"))

WEATHER_INTERVAL = 15 * 60
ANCHOR_HOURS = 1
BRIEF_SCAN_SECONDS = 60
BRIEFING_HOUR = 18  # 6 PM local

DONE_FILE = LIVE / "briefings_done.json"


def active_stop_works() -> set[str]:
    state = read_json(STOP_WORK_FILE, {})
    return {a["site_id"] for a in state.get("alerts", [])
            if a.get("status") == "active" and a.get("type") == "stop_work_lightning"}


def run_weather_and_scores() -> list[dict]:
    """The full M3 chain. Returns the score_updated events it appended."""
    from cypress_ml.score import score_sites
    from cypress_ai.explain.explainer import explain_scores

    weather_path = weather_live.run(weather_live.DEFAULT_SITES, past_days=30, forecast_days=3)
    weather = read_json(weather_path, {})
    sites = load_sites()
    previous = {s["site_id"]: s.get("hazard_score")
                for s in store.read_scores()["scores"] if s.get("day_offset") == 0}

    scores = score_sites(weather, list(sites.values()), days=(0, 1), stop_work=active_stop_works())
    scores = explain_scores(scores, list(sites.values()))  # Gemini writes 1 sentence per site; template fallback
    store.save_scores(scores)               # -> scores_latest.json, same file the beacon bridge polls
    events = store.score_updated_events(scores, previous)
    append_events(events)
    print(f"[{now_iso()}] chain: {len(scores)} sites scored, {len(events)} score change(s)")
    return events


def run_anchor() -> None:
    from cypress_workers.scheduler.anchor import anchor_period
    try:
        outcome = anchor_period()
        print(f"[{now_iso()}] ledger: {outcome}")
    except Exception as e:
        print(f"[{now_iso()}] ledger: postponed ({e})")


def run_briefings() -> list[str]:
    """Generate each site's briefing when its own local clock hits 6 PM."""
    from cypress_ai.briefing.briefing import generate_briefing

    sites = load_sites()
    weather_by_site = {r["site_id"]: r for r in read_json(WEATHER_FILE, {}).get("sites", [])}
    scores_tomorrow = {s["site_id"]: s for s in store.read_scores()["scores"] if s.get("day_offset") == 1}
    done = read_json(DONE_FILE, {"done_dates": {}})
    made = []
    for site_id, site in sites.items():
        local = datetime.now(ZoneInfo(site["timezone"]))
        if local.hour != BRIEFING_HOUR:  # one scan per local day
            continue
        key = f"{site_id}:{local:%Y-%m-%d}"
        if done["done_dates"].get(key):
            continue
        try:
            r = generate_briefing(site, weather_by_site.get(site_id, {}), scores_tomorrow.get(site_id))
            out = LIVE / "briefings" / f"{site_id}_{r['for_date']}.json"
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps(r, indent=2, ensure_ascii=False))
            append_events([make_event("briefing_ready", site_id,
                                      {"briefing_id": r["en"]["briefing_id"], "for_date": r["for_date"]})])
            done["done_dates"][key] = now_iso()
            made.append(site_id)
            print(f"  briefing {site_id} -> {r['for_date']} ({'validated' if r['validated'] else 'template'})")
        except Exception as e:  # one site's briefing failure must not break the scan
            print(f"  briefing {site_id}: skipped ({e})")
    write_json(DONE_FILE, done)
    return made


def main() -> None:
    ap = argparse.ArgumentParser(description="Refresh live site scores and scheduled outputs.")
    ap.add_argument("--weather-only", action="store_true",
                    help="refresh weather and scores without ledger anchoring or briefings")
    args = ap.parse_args()
    last = {"weather": 0.0, "anchor": 0.0, "brief": 0.0}
    print(f"Scheduler up: chain every {WEATHER_INTERVAL}s"
          + (" (weather and scores only)" if args.weather_only else f", ledger anchor every {ANCHOR_HOURS}h"))
    while True:
        now = time.time()
        if now - last["weather"] >= WEATHER_INTERVAL:
            last["weather"] = now
            try:
                run_weather_and_scores()
            except Exception as e:
                print(f"[{now_iso()}] chain failed: {e}")
        if not args.weather_only and now - last["anchor"] >= ANCHOR_HOURS * 3600:
            last["anchor"] = now
            run_anchor()
        if not args.weather_only and now - last["brief"] >= BRIEF_SCAN_SECONDS:
            last["brief"] = now
            try:
                run_briefings()
            except Exception as e:
                print(f"[{now_iso()}] briefings failed: {e}")
        time.sleep(5)


if __name__ == "__main__":
    main()
