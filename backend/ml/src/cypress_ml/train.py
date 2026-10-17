"""Step 4: train the final hazard-index model and save everything the app needs.

Usage (from the repo root, conda env active):
    python backend/ml/src/cypress_ml/train.py

What it does:
  1. Trains LightGBM on 2015–2021 and uses 2022 to choose the number of trees (early stopping).
  2. Retrains on 2015–2022 with that number of trees.
  3. Evaluates once on the untouched test years 2023–2024, against two baselines.
  4. Stores the cut-offs that turn a probability into a 0–10 score
     (score 8 = riskier than 80% of past site-days).

Writes:
  backend/ml/models/hazard_index_v1.txt        the LightGBM model
  backend/ml/models/hazard_index_v1.meta.json  features, score cut-offs, metrics
  backend/ml/reports/model_card.json           summary for the app's model page and the README
"""
import json
from datetime import datetime, timezone
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score

ML_DIR = Path(__file__).resolve().parents[2]
TABLE = ML_DIR / "data" / "processed" / "training_table.csv.gz"
MODELS = ML_DIR / "models"
REPORTS = ML_DIR / "reports"
MODEL_VERSION = "hazard-index-v1"

FEATURES = ["temperature_2m_max", "apparent_temperature_max", "precipitation_sum", "precipitation_hours",
            "wind_gusts_10m_max", "rain_3d_in", "rain_7d_in", "rain_30d_in", "days_since_rain",
            "heavy_rain_day", "season_sin", "season_cos", "lat", "lon"]
PARAMS = dict(learning_rate=0.03, num_leaves=31, min_child_samples=100, subsample=0.8, subsample_freq=1,
              colsample_bytree=0.8, random_state=42, verbose=-1)


def metrics(y, p) -> dict:
    return {"roc_auc": round(float(roc_auc_score(y, p)), 4),
            "pr_auc": round(float(average_precision_score(y, p)), 4),
            "brier": round(float(brier_score_loss(y, p)), 4)}


def main() -> None:
    t = pd.read_csv(TABLE, parse_dates=["date"])
    year = t["date"].dt.year
    train, val, test = t[year <= 2021], t[year == 2022], t[year >= 2023]
    fit_all = t[year <= 2022]

    # 1) Choose the number of trees on 2022.
    probe = lgb.LGBMClassifier(n_estimators=2000, **PARAMS)
    probe.fit(train[FEATURES], train["label"], eval_set=[(val[FEATURES], val["label"])],
              eval_metric="average_precision", callbacks=[lgb.early_stopping(100, verbose=False)])
    n_trees = max(int(probe.best_iteration_), 20)
    val_metrics = metrics(val["label"], probe.predict_proba(val[FEATURES])[:, 1])

    # 2) Final model on 2015–2022.
    model = lgb.LGBMClassifier(n_estimators=n_trees, **PARAMS).fit(fit_all[FEATURES], fit_all["label"])

    # 3) One honest check on 2023–2024, with baselines fitted on the same years as the model.
    p_test = model.predict_proba(test[FEATURES])[:, 1]
    month_rate = fit_all.groupby(fit_all["date"].dt.month)["label"].mean()
    heat = LogisticRegression(max_iter=1000).fit(fit_all[["apparent_temperature_max"]], fit_all["label"])
    test_metrics = {
        "LightGBM": metrics(test["label"], p_test),
        "Baseline: month only": metrics(test["label"], test["date"].dt.month.map(month_rate)),
        "Baseline: heat only": metrics(test["label"], heat.predict_proba(test[["apparent_temperature_max"]])[:, 1]),
    }

    # 4) Probability -> 0–10 score cut-offs, from the model's own predictions on its training years.
    cutoffs = np.quantile(model.predict_proba(fit_all[FEATURES])[:, 1], np.linspace(0, 1, 101))

    MODELS.mkdir(parents=True, exist_ok=True)
    REPORTS.mkdir(parents=True, exist_ok=True)
    model.booster_.save_model(str(MODELS / f"{MODEL_VERSION.replace('-', '_')}.txt"))
    trained_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    importance = pd.Series(model.booster_.feature_importance("gain"), index=FEATURES)
    importance = (importance / importance.sum()).sort_values(ascending=False).round(4)

    meta = {
        "model_version": MODEL_VERSION, "trained_at": trained_at, "features": FEATURES,
        "n_trees": n_trees, "train_years": "2015-2022", "test_years": "2023-2024",
        "score_cutoffs": [float(c) for c in cutoffs],
        "validation_2022": val_metrics, "test_2023_2024": test_metrics,
        "positive_rate_train": round(float(fit_all["label"].mean()), 4),
        "sites": int(t["site_id"].nunique()), "rows": int(len(t)),
    }
    (MODELS / f"{MODEL_VERSION.replace('-', '_')}.meta.json").write_text(json.dumps(meta, indent=2))

    card = {  # same shape as ModelCard in contracts/types.ts
        "model_version": MODEL_VERSION,
        "algorithm": f"LightGBM gradient-boosted trees ({n_trees} trees); probability mapped to a 0–10 percentile score",
        "trained_at": trained_at,
        "training_data": [
            {"name": "NOAA Storm Events (FL, GA, AL), events within 25 miles of a site", "rows": int(len(t)), "years": "2015-2024"},
            {"name": "Open-Meteo historical daily weather per site", "rows": int(len(t)), "years": "2015-2024"},
        ],
        "label": "A hazardous NOAA Storm Event (storm, flood, heat, wildfire, high wind) within 25 miles of the site that day",
        "features": FEATURES,
        "evaluation": [{"split": "Time-based: trained 2015–2022, tested on 2023–2024", "metric": "PR AUC",
                        "model": test_metrics["LightGBM"]["pr_auc"],
                        "baseline": test_metrics["Baseline: month only"]["pr_auc"],
                        "baseline_name": "Month only (seasonal climatology)"},
                       {"split": "Time-based: trained 2015–2022, tested on 2023–2024", "metric": "ROC AUC",
                        "model": test_metrics["LightGBM"]["roc_auc"],
                        "baseline": test_metrics["Baseline: month only"]["roc_auc"],
                        "baseline_name": "Month only (seasonal climatology)"}],
        "calibration_note": "Calibration checked on 2023–2024 (reports/calibration_both.png). "
                            "The app shows a percentile score, not a raw probability.",
        "top_global_features": [{"feature": f, "importance": float(v)} for f, v in importance.head(6).items()],
        "limitations": [
            "Labels come from reported storm events; unreported hazards count as calm days.",
            "Heat events are rarely reported in Florida, so heat risk is also checked by a rule-based heat index.",
            "Zone-wide events (e.g. heat) are matched to sites by county name.",
            "Live lightning, flood warnings and active fires are applied by rules on top of the model score.",
        ],
    }
    (REPORTS / "model_card.json").write_text(json.dumps(card, indent=2))

    print(f"Trees: {n_trees} (chosen on 2022) | trained on {len(fit_all):,} rows (2015–2022)")
    print(f"Validation 2022: {val_metrics}")
    print("Test 2023–2024:")
    for name, m in test_metrics.items():
        print(f"  {name:22s} {m}")
    print(f"Saved model to {MODELS}/ and model card to {REPORTS / 'model_card.json'}")


if __name__ == "__main__":
    main()