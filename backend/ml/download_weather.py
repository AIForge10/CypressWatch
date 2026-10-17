# """Download daily historical weather for every site (features for the hazard model).

# Usage (from any folder, conda env active):
#     python <path-to>/ml/download_weather.py --start 2015-01-01 --end 2024-12-31

# Uses the free Open-Meteo Historical Weather API (no key). Saves one CSV per site
# to ml/data/raw/weather/<site_id>.csv next to this script, with dates in the site's own local time zone.
# Skips sites already downloaded, so it is safe to re-run.
# """
# import argparse
# import json
# import time
# from pathlib import Path

# import pandas as pd
# import requests

# URL = "https://archive-api.open-meteo.com/v1/archive"
# # Data is saved next to this script (…/ml/data/raw/weather), wherever the ml folder lives.
# SCRIPT_DIR = Path(__file__).resolve().parent
# OUT = SCRIPT_DIR / "data" / "raw" / "weather"

# # Only variables that the live forecast API also provides, so the model can score live data.
# DAILY_VARS = [
#     "temperature_2m_max",
#     "apparent_temperature_max",
#     "precipitation_sum",
#     "precipitation_hours",
#     "wind_gusts_10m_max",
# ]


# def find_default_sites() -> str:
#     """Look upward from this script for contracts/mocks/sites.json, so it works from backend/ml or ml."""
#     for folder in [SCRIPT_DIR, *SCRIPT_DIR.parents]:
#         candidate = folder / "contracts" / "mocks" / "sites.json"
#         if candidate.exists():
#             return str(candidate)
#     raise SystemExit("Could not find contracts/mocks/sites.json. Pass it with --sites <path>.")


# def load_sites(path: str) -> list[dict]:
#     data = json.load(open(path))
#     sites = data["sites"] if isinstance(data, dict) else data
#     return [{"site_id": s["site_id"], "lat": s["lat"], "lon": s["lon"]} for s in sites]


# def fetch_site(site: dict, start: str, end: str, retries: int = 5) -> pd.DataFrame:
#     params = {
#         "latitude": site["lat"],
#         "longitude": site["lon"],
#         "start_date": start,
#         "end_date": end,
#         "daily": ",".join(DAILY_VARS),
#         "timezone": "auto",  # dates in the site's local time, to match Storm Events local dates
#         "temperature_unit": "fahrenheit",
#         "wind_speed_unit": "mph",
#         "precipitation_unit": "inch",
#     }
#     for attempt in range(retries):
#         r = requests.get(URL, params=params, timeout=120)
#         if r.status_code == 429 or r.status_code >= 500:  # rate limit or server error: wait and retry
#             wait = 30 * (attempt + 1)
#             print(f"  {site['site_id']}: HTTP {r.status_code}, retrying in {wait}s")
#             time.sleep(wait)
#             continue
#         r.raise_for_status()
#         daily = r.json()["daily"]
#         df = pd.DataFrame(daily).rename(columns={"time": "date"})
#         df.insert(0, "site_id", site["site_id"])
#         return df
#     raise RuntimeError(f"{site['site_id']}: failed after {retries} attempts")


# def main() -> None:
#     p = argparse.ArgumentParser()
#     p.add_argument("--sites", default=None, help="sites JSON; default: find contracts/mocks/sites.json")
#     p.add_argument("--start", default="2015-01-01")
#     p.add_argument("--end", default="2024-12-31")
#     p.add_argument("--pause", type=float, default=2.0, help="seconds between sites, to be polite")
#     args = p.parse_args()

#     OUT.mkdir(parents=True, exist_ok=True)
#     sites_path = args.sites or find_default_sites()
#     print(f"Sites: {sites_path}")
#     sites = load_sites(sites_path)
#     print(f"{len(sites)} sites, {args.start} to {args.end}")
#     for i, site in enumerate(sites, 1):
#         dest = OUT / f"{site['site_id']}.csv"
#         if dest.exists():
#             print(f"[{i}/{len(sites)}] {site['site_id']}: already downloaded")
#             continue
#         df = fetch_site(site, args.start, args.end)
#         df.to_csv(dest, index=False)
#         print(f"[{i}/{len(sites)}] {site['site_id']}: {len(df)} days")
#         time.sleep(args.pause)
#     print(f"Done. Files are in {OUT}/")


# if __name__ == "__main__":
#     main()


"""Download daily historical weather for every site (features for the hazard model).

Usage (from any folder, conda env active):
    python <path-to>/ml/download_weather.py --start 2015-01-01 --end 2024-12-31

Uses the free Open-Meteo Historical Weather API (no key). Saves one CSV per site
to ml/data/raw/weather/<site_id>.csv next to this script, with dates in the site's own local time zone.
Skips sites already downloaded, so it is safe to re-run.
"""
import argparse
import json
import time
from pathlib import Path

import pandas as pd
import requests

URL = "https://archive-api.open-meteo.com/v1/archive"
# Data is saved next to this script (…/ml/data/raw/weather), wherever the ml folder lives.
SCRIPT_DIR = Path(__file__).resolve().parent
OUT = SCRIPT_DIR / "data" / "raw" / "weather"

# Only variables that the live forecast API also provides, so the model can score live data.
DAILY_VARS = [
    "temperature_2m_max",
    "apparent_temperature_max",
    "precipitation_sum",
    "precipitation_hours",
    "wind_gusts_10m_max",
]


def find_default_sites() -> str:
    """Look upward from this script for contracts/mocks/sites.json, so it works from backend/ml or ml."""
    for folder in [SCRIPT_DIR, *SCRIPT_DIR.parents]:
        candidate = folder / "contracts" / "mocks" / "sites.json"
        if candidate.exists():
            return str(candidate)
    raise SystemExit("Could not find contracts/mocks/sites.json. Pass it with --sites <path>.")


def load_sites(path: str) -> list[dict]:
    data = json.load(open(path))
    sites = data["sites"] if isinstance(data, dict) else data
    return [{"site_id": s["site_id"], "lat": s["lat"], "lon": s["lon"]} for s in sites]


def fetch_site(site: dict, start: str, end: str, retries: int = 5) -> pd.DataFrame:
    params = {
        "latitude": site["lat"],
        "longitude": site["lon"],
        "start_date": start,
        "end_date": end,
        "daily": ",".join(DAILY_VARS),
        "timezone": "auto",  # dates in the site's local time, to match Storm Events local dates
        "temperature_unit": "fahrenheit",
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
    }
    reason = ""
    for attempt in range(retries):
        r = requests.get(URL, params=params, timeout=120)
        if r.status_code == 429 or r.status_code >= 500:  # rate limit or server error: wait and retry
            try:
                reason = r.json().get("reason", "")
            except ValueError:
                reason = r.text[:200]
            wait = 30 * (attempt + 1)
            print(f"  {site['site_id']}: HTTP {r.status_code} {reason}, retrying in {wait}s")
            time.sleep(wait)
            continue
        r.raise_for_status()
        daily = r.json()["daily"]
        df = pd.DataFrame(daily).rename(columns={"time": "date"})
        df.insert(0, "site_id", site["site_id"])
        return df
    raise RateLimited(reason or f"HTTP error after {retries} attempts")


class RateLimited(Exception):
    """The free API limit is used up; finished sites are kept, so re-run later."""


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--sites", default=None, help="sites JSON; default: find contracts/mocks/sites.json")
    p.add_argument("--start", default="2015-01-01")
    p.add_argument("--end", default="2024-12-31")
    p.add_argument("--pause", type=float, default=2.0, help="seconds between sites, to be polite")
    args = p.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    sites_path = args.sites or find_default_sites()
    print(f"Sites: {sites_path}")
    sites = load_sites(sites_path)
    print(f"{len(sites)} sites, {args.start} to {args.end}")
    for i, site in enumerate(sites, 1):
        dest = OUT / f"{site['site_id']}.csv"
        if dest.exists():
            print(f"[{i}/{len(sites)}] {site['site_id']}: already downloaded")
            continue
        try:
            df = fetch_site(site, args.start, args.end)
        except RateLimited as e:
            done = sum(1 for s in sites if (OUT / f"{s['site_id']}.csv").exists())
            print(f"\nStopped: Open-Meteo's free usage limit is reached ({e}).")
            print(f"{done} of {len(sites)} sites are saved and will be skipped next time.")
            print("Run the same command again later to download the rest.")
            raise SystemExit(1)
        df.to_csv(dest, index=False)
        print(f"[{i}/{len(sites)}] {site['site_id']}: {len(df)} days")
        time.sleep(args.pause)
    print(f"Done. All {len(sites)} sites are in {OUT}/")


if __name__ == "__main__":
    main()