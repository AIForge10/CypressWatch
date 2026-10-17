"""Live weather worker: fetch current conditions and the daily forecast for every site.

Usage (from the repo root, conda env active):
    python backend/workers/cypress_workers/ingest/weather_live.py

Reads the real site list (backend/data/sites/sites.json), calls the free Open-Meteo
forecast API (no key) for all sites in a few batched requests, and saves:
  backend/workers/data/live/weather_latest.json             latest snapshot (API and dashboard read this)
  backend/workers/data/live/archive/weather_<UTC time>.json  every run, for forecast-drift history

The daily variables, units and local-time dates match the training data downloaded by
backend/ml/download_weather.py, so the ML model scores live data in the same format it learned from.
It also includes the past 30 days, so rolling rain and days-since-rain features can be computed.
M4 schedules this every 15 minutes and later writes the same records into Tiger Data.
"""
import argparse
import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

URL = "https://api.open-meteo.com/v1/forecast"
HERE = Path(__file__).resolve()
WORKERS_DIR = next(p for p in HERE.parents if p.name == "workers")
BACKEND_DIR = WORKERS_DIR.parent
DEFAULT_SITES = BACKEND_DIR / "data" / "sites" / "sites.json"
OUT_DIR = WORKERS_DIR / "data" / "live"

# Must match DAILY_VARS in backend/ml/download_weather.py (the model's training data).
DAILY_VARS = [
    "temperature_2m_max",
    "apparent_temperature_max",
    "precipitation_sum",
    "precipitation_hours",
    "wind_gusts_10m_max",
]
# Hourly forecast for today and tomorrow: storm timing, heat peaks and the best work window in the briefing.
HOURLY_VARS = [
    "temperature_2m",
    "relative_humidity_2m",
    "apparent_temperature",
    "precipitation_probability",
    "precipitation",
    "wind_gusts_10m",
    "weather_code",  # 95, 96, 99 = thunderstorm
]
CURRENT_VARS = [
    "temperature_2m",
    "relative_humidity_2m",
    "apparent_temperature",
    "precipitation",
    "wind_gusts_10m",
    "weather_code",
]
BATCH = 20  # sites per request, keeps the URL short


def heat_index_f(temp_f: float | None, rh: float | None) -> float | None:
    """NWS heat index (Rothfusz regression with NWS adjustments). Returns None if inputs are missing."""
    if temp_f is None or rh is None:
        return None
    t, r = float(temp_f), float(rh)
    simple = 0.5 * (t + 61.0 + (t - 68.0) * 1.2 + r * 0.094)
    if (simple + t) / 2 < 80:
        return round(simple, 1)
    hi = (-42.379 + 2.04901523 * t + 10.14333127 * r - 0.22475541 * t * r
          - 0.00683783 * t * t - 0.05481717 * r * r + 0.00122874 * t * t * r
          + 0.00085282 * t * r * r - 0.00000199 * t * t * r * r)
    if r < 13 and 80 <= t <= 112:
        hi -= ((13 - r) / 4) * math.sqrt((17 - abs(t - 95)) / 17)
    elif r > 85 and 80 <= t <= 87:
        hi += ((r - 85) / 10) * ((87 - t) / 5)
    return round(hi, 1)


def load_sites(path: Path) -> list[dict]:
    data = json.loads(path.read_text())
    return data["sites"] if isinstance(data, dict) else data


def _base_params(sites: list[dict]) -> dict:
    return {
        "latitude": ",".join(str(s["lat"]) for s in sites),
        "longitude": ",".join(str(s["lon"]) for s in sites),
        "timezone": "auto",  # each site's own local dates and hours, same as the training data
        "temperature_unit": "fahrenheit",
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
    }


def fetch_batch(sites: list[dict], past_days: int, forecast_days: int) -> list[dict]:
    params = _base_params(sites) | {"daily": ",".join(DAILY_VARS), "current": ",".join(CURRENT_VARS),
                                    "past_days": past_days, "forecast_days": forecast_days}
    return _request(params)


def fetch_hourly_batch(sites: list[dict]) -> list[dict]:
    """Separate small request: hourly data only for today and tomorrow (not the 30 past days)."""
    return _request(_base_params(sites) | {"hourly": ",".join(HOURLY_VARS), "forecast_days": 2})


def _request(params: dict, retries: int = 4) -> list[dict]:
    for attempt in range(retries):
        r = requests.get(URL, params=params, timeout=60)
        if r.status_code == 429 or r.status_code >= 500:
            wait = 15 * (attempt + 1)
            print(f"  HTTP {r.status_code}, retrying in {wait}s")
            time.sleep(wait)
            continue
        r.raise_for_status()
        body = r.json()
        return body if isinstance(body, list) else [body]  # one site returns an object, several a list
    raise RuntimeError(f"Forecast request failed after {retries} attempts")


def to_record(site: dict, api: dict, fetched_at: str, hourly_api: dict | None = None) -> dict:
    cur = api.get("current", {})
    daily = api.get("daily", {})
    days = [{"date": d, **{v: daily[v][i] for v in DAILY_VARS}} for i, d in enumerate(daily.get("time", []))]
    h = (hourly_api or {}).get("hourly", {})
    hours = []
    for i, t in enumerate(h.get("time", [])):
        row = {"time": t, **{v: h[v][i] for v in HOURLY_VARS if v in h}}
        row["heat_index_f"] = heat_index_f(row.get("temperature_2m"), row.get("relative_humidity_2m"))
        hours.append(row)
    return {
        "site_id": site["site_id"],
        "timezone": api.get("timezone", site.get("timezone")),
        "fetched_at": fetched_at,
        "source": "open-meteo",
        "current": {
            "observed_at_local": cur.get("time"),
            "temperature_f": cur.get("temperature_2m"),
            "humidity_pct": cur.get("relative_humidity_2m"),
            "apparent_temperature_f": cur.get("apparent_temperature"),
            "heat_index_f": heat_index_f(cur.get("temperature_2m"), cur.get("relative_humidity_2m")),
            "precipitation_in": cur.get("precipitation"),
            "wind_gust_mph": cur.get("wind_gusts_10m"),
            "weather_code": cur.get("weather_code"),
        },
        "daily": days,  # past days first, then today and the forecast days
        "hourly": hours,  # today and tomorrow, local time, with NWS heat index per hour
    }


def run(sites_path: Path, past_days: int, forecast_days: int) -> Path:
    sites = load_sites(sites_path)
    fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    records = []
    for i in range(0, len(sites), BATCH):
        chunk = sites[i:i + BATCH]
        results = fetch_batch(chunk, past_days, forecast_days)
        hourly = fetch_hourly_batch(chunk)
        if len(results) != len(chunk) or len(hourly) != len(chunk):
            raise RuntimeError(f"Expected {len(chunk)} locations, got {len(results)} daily / {len(hourly)} hourly")
        records += [to_record(s, a, fetched_at, h) for s, a, h in zip(chunk, results, hourly)]
        print(f"  fetched {min(i + BATCH, len(sites))}/{len(sites)} sites")

    snapshot = {"fetched_at": fetched_at, "site_count": len(records), "sites": records}
    (OUT_DIR / "archive").mkdir(parents=True, exist_ok=True)
    latest = OUT_DIR / "weather_latest.json"
    latest.write_text(json.dumps(snapshot, indent=2))
    stamp = fetched_at.replace(":", "").replace("-", "")
    (OUT_DIR / "archive" / f"weather_{stamp}.json").write_text(json.dumps(snapshot))
    return latest


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sites", default=str(DEFAULT_SITES))
    ap.add_argument("--past-days", type=int, default=30, help="history for rolling rain features")
    ap.add_argument("--forecast-days", type=int, default=8, help="today plus the next 7 days")
    args = ap.parse_args()
    path = run(Path(args.sites), args.past_days, args.forecast_days)
    print(f"Saved {path}")


if __name__ == "__main__":
    main()