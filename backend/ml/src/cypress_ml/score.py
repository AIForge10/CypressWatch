"""Score every site 0–10 from the latest live weather. This is what the backend calls.

Usage (from the repo root, conda env active):
    python backend/ml/src/cypress_ml/score.py
    python backend/ml/src/cypress_ml/score.py --stop-work site_6043   # sites with an active lightning stop-work

Reads:  backend/workers/data/live/weather_latest.json   (from the live weather worker)
        backend/data/sites/sites.json                    (site coordinates)
        backend/ml/models/hazard_index_v1.txt + .meta.json (from train.py)
Writes: backend/workers/data/live/scores_latest.json     (scores for today and tomorrow)

From Python (M4):
    from cypress_ml.score import score_sites
    scores = score_sites(weather_snapshot, sites, days=(0, 1), stop_work={"site_6043"})
Each result matches the `score` block in contracts/mocks/site_detail.json, plus site_id and date.
"""
import argparse
import json
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

try:  # imported as a package by the backend
    from cypress_ml.build_dataset import add_features
except ImportError:  # run as a script from this folder
    from build_dataset import add_features

ML_DIR = Path(__file__).resolve().parents[2]
BACKEND = ML_DIR.parent
MODEL_FILE = ML_DIR / "models" / "hazard_index_v1.txt"
META_FILE = ML_DIR / "models" / "hazard_index_v1.meta.json"
WEATHER_FILE = BACKEND / "workers" / "data" / "live" / "weather_latest.json"
SITES_FILE = BACKEND / "data" / "sites" / "sites.json"
OUT_FILE = BACKEND / "workers" / "data" / "live" / "scores_latest.json"

STOP_WORK_FLOOR = 9.0  # an active lightning stop-work always ranks a site near the top

# Features that only make sense together are reported as one reason.
GROUPS = {"lat": "location", "lon": "location", "season_sin": "season", "season_cos": "season"}
LABELS = {
    "precipitation_sum": lambda r: f"Rain {r['precipitation_sum']:.1f} in",
    "precipitation_hours": lambda r: f"{r['precipitation_hours']:.0f} hours of rain",
    "wind_gusts_10m_max": lambda r: f"Wind gusts {r['wind_gusts_10m_max']:.0f} mph",
    "apparent_temperature_max": lambda r: f"Feels like {r['apparent_temperature_max']:.0f}°F",
    "temperature_2m_max": lambda r: f"High of {r['temperature_2m_max']:.0f}°F",
    "rain_3d_in": lambda r: f"{r['rain_3d_in']:.1f} in of rain in 3 days",
    "rain_7d_in": lambda r: f"{r['rain_7d_in']:.1f} in of rain this week",
    "rain_30d_in": lambda r: f"{r['rain_30d_in']:.1f} in of rain this month",
    "days_since_rain": lambda r: f"{r['days_since_rain']:.0f} days since rain",
    "heavy_rain_day": lambda r: "Heavy rain (2+ in)",
    "location": lambda r: "Area with frequent past hazard reports",
    "season": lambda r: "Time of year",
}


@lru_cache(maxsize=1)
def load_model() -> tuple[lgb.Booster, dict]:
    meta = json.loads(META_FILE.read_text())
    return lgb.Booster(model_file=str(MODEL_FILE)), meta


def risk_level(score: float) -> str:
    return "low" if score < 4 else "moderate" if score < 6 else "high" if score < 8 else "extreme"


def to_score(prob: np.ndarray, cutoffs: list[float]) -> np.ndarray:
    """Percentile of the probability among historical site-days, on a 0–10 scale."""
    return (np.searchsorted(np.asarray(cutoffs), prob, side="right").clip(1, 101) - 1) / 10


def live_feature_rows(snapshot: dict, sites: list[dict], days: tuple[int, ...]) -> pd.DataFrame:
    """Build feature rows for each site's local today (+ offsets) with the same code as training."""
    coords = {s["site_id"]: (s["lat"], s["lon"]) for s in sites}
    rows = []
    for rec in snapshot["sites"]:
        if rec["site_id"] not in coords or not rec.get("daily"):
            continue
        w = pd.DataFrame(rec["daily"]).assign(site_id=rec["site_id"])
        w["date"] = pd.to_datetime(w["date"])
        feats = add_features(w)
        today = pd.Timestamp((rec.get("current", {}).get("observed_at_local") or str(w["date"].iloc[-8]))[:10])
        for offset in days:
            day = feats[feats["date"] == today + pd.Timedelta(days=offset)]
            if not day.empty:
                rows.append(day.assign(lat=coords[rec["site_id"]][0], lon=coords[rec["site_id"]][1], day_offset=offset))
    return pd.concat(rows, ignore_index=True) if rows else pd.DataFrame()


def top_factors(row: pd.Series, contrib: np.ndarray, features: list[str], k: int = 4) -> list[dict]:
    grouped: dict[str, float] = {}
    for f, c in zip(features, contrib):
        key = GROUPS.get(f, f)
        grouped[key] = grouped.get(key, 0.0) + float(c)
    ranked = sorted(((k_, v) for k_, v in grouped.items() if v > 0), key=lambda kv: -kv[1])[:k]
    return [{"feature": f, "label": LABELS[f](row), "contribution": round(v, 3)} for f, v in ranked]


def score_sites(snapshot: dict, sites: list[dict], days: tuple[int, ...] = (0, 1),
                stop_work: set[str] | frozenset = frozenset()) -> list[dict]:
    booster, meta = load_model()
    features = meta["features"]
    X = live_feature_rows(snapshot, sites, days)
    if X.empty:
        return []
    prob = booster.predict(X[features])
    contrib = booster.predict(X[features], pred_contrib=True)[:, :-1]  # SHAP values; last column is the bias
    scores = to_score(prob, meta["score_cutoffs"])
    scored_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    out = []
    for i, row in X.iterrows():
        score = float(scores[i])
        factors = top_factors(row, contrib[i], features)
        if row["day_offset"] == 0 and row["site_id"] in stop_work and score < STOP_WORK_FLOOR:
            factors.insert(0, {"feature": "lightning_stop_work", "label": "Lightning within 10 miles (stop-work active)",
                               "contribution": round(STOP_WORK_FLOOR - score, 2), "rule": True})
            score = STOP_WORK_FLOOR
        out.append({
            "site_id": row["site_id"], "date": row["date"].strftime("%Y-%m-%d"), "day_offset": int(row["day_offset"]),
            "hazard_score": round(score, 1), "risk_level": risk_level(score),
            "model_probability": round(float(prob[i]), 4), "model_version": meta["model_version"],
            "scored_at": scored_at, "weather_fetched_at": snapshot.get("fetched_at"),
            "top_factors": factors, "explanation": None,  # Gemini fills this in from top_factors
        })
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weather", default=str(WEATHER_FILE))
    ap.add_argument("--sites", default=str(SITES_FILE))
    ap.add_argument("--stop-work", default="", help="comma-separated site_ids with an active lightning stop-work")
    args = ap.parse_args()

    snapshot = json.loads(Path(args.weather).read_text())
    sites_json = json.loads(Path(args.sites).read_text())
    sites = sites_json["sites"] if isinstance(sites_json, dict) else sites_json
    stop = {s for s in args.stop_work.split(",") if s}
    results = score_sites(snapshot, sites, days=(0, 1), stop_work=stop)

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps({"scored_at": results[0]["scored_at"] if results else None,
                                    "weather_fetched_at": snapshot.get("fetched_at"), "scores": results}, indent=2))
    today = sorted((r for r in results if r["day_offset"] == 0), key=lambda r: -r["hazard_score"])
    names = {s["site_id"]: s.get("name", s["site_id"]) for s in sites}
    skipped = {r["site_id"] for r in snapshot["sites"]} - {r["site_id"] for r in today}
    if skipped:
        print(f"Warning: {len(skipped)} site(s) not scored (missing from sites.json or under 30 days of weather): "
              f"{sorted(skipped)[:5]}")
    print(f"Scored {len(today)} sites for today (+ tomorrow). Top 10:")
    for r in today[:10]:
        reasons = "; ".join(f["label"] for f in r["top_factors"][:3])
        print(f"  {r['hazard_score']:4.1f} {r['risk_level']:8s} {names[r['site_id']][:32]:32s} {reasons}")
    print(f"Saved {OUT_FILE}")


if __name__ == "__main__":
    main()