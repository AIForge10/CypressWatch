"""Step 2: build the training table for the hazard-index model.

One row = one site on one local calendar day.
  Inputs (features): that day's weather plus rolling rain and dry-spell features.
  Answer (label):    1 if a hazardous NOAA Storm Event happened near the site that day, else 0.

Usage (from the repo root, conda env active):
    python backend/ml/src/cypress_ml/build_dataset.py

Reads:  backend/ml/data/raw/weather/*.csv          (from download_weather.py)
        backend/ml/data/raw/storm_events/*.csv.gz  (from download_storm_events.py)
        contracts/mocks/sites.json                 (site coordinates and counties)
Writes: backend/ml/data/processed/training_table.csv.gz
"""
import argparse
import json
import re
from pathlib import Path

import numpy as np
import pandas as pd

ML_DIR = Path(__file__).resolve().parents[2]          # backend/ml
RAW = ML_DIR / "data" / "raw"
OUT = ML_DIR / "data" / "processed" / "training_table.csv.gz"

RADIUS_MILES = 25          # an event this close to a site counts for that site
MAX_EVENT_DAYS = 7         # cap for long events (heat waves, river floods)
# Florida plus neighbours, so storms just across the state line still count for Panhandle sites.
COORD_STATES = {"FLORIDA", "GEORGIA", "ALABAMA"}

# NOAA event types we treat as hazards for field crews, grouped for analysis.
HAZARD_GROUPS = {
    "storm": ["Thunderstorm Wind", "Lightning", "Hail", "Tornado"],
    "flood": ["Flash Flood", "Flood", "Heavy Rain", "Coastal Flood", "Storm Surge/Tide"],
    "heat": ["Heat", "Excessive Heat"],
    "fire": ["Wildfire"],
    "wind": ["High Wind", "Strong Wind", "Tropical Storm", "Tropical Depression",
             "Hurricane", "Hurricane (Typhoon)"],
}
EVENT_TO_GROUP = {e: g for g, events in HAZARD_GROUPS.items() for e in events}

STORM_COLS = ["BEGIN_YEARMONTH", "BEGIN_DAY", "END_YEARMONTH", "END_DAY", "STATE", "EVENT_TYPE",
              "CZ_TYPE", "CZ_NAME", "BEGIN_LAT", "BEGIN_LON", "END_LAT", "END_LON", "EVENT_ID"]


# ---------- sites ----------

def find_sites_file() -> Path:
    for folder in [ML_DIR, *ML_DIR.parents]:
        f = folder / "contracts" / "mocks" / "sites.json"
        if f.exists():
            return f
    raise SystemExit("contracts/mocks/sites.json not found; pass --sites")


def load_sites(path: Path, weather_dir: Path) -> pd.DataFrame:
    data = json.loads(path.read_text())
    sites = pd.DataFrame(data["sites"] if isinstance(data, dict) else data)
    have = {p.stem for p in weather_dir.glob("*.csv")}
    sites = sites[sites["site_id"].isin(have)].reset_index(drop=True)
    if sites.empty:
        raise SystemExit(f"No weather files in {weather_dir} match the sites in {path}")
    return sites[["site_id", "lat", "lon", "county"]]


# ---------- weather features ----------

def load_weather(weather_dir: Path, site_ids: list[str]) -> pd.DataFrame:
    frames = [pd.read_csv(weather_dir / f"{s}.csv") for s in site_ids]
    w = pd.concat(frames, ignore_index=True)
    w["date"] = pd.to_datetime(w["date"])
    return w.sort_values(["site_id", "date"]).reset_index(drop=True)


def days_since_rain(rain: pd.Series, threshold: float = 0.01) -> pd.Series:
    """0 on a rainy day, then 1, 2, 3... for each dry day after it."""
    wet = (rain.fillna(0) >= threshold).to_numpy()
    out = np.zeros(len(wet), dtype=float)
    count = 0.0
    for i, is_wet in enumerate(wet):
        count = 0.0 if is_wet else count + 1
        out[i] = count
    return pd.Series(out, index=rain.index)


def add_features(w: pd.DataFrame) -> pd.DataFrame:
    """Same-day weather plus history. Every feature here can also be computed live from the forecast."""
    g = w.groupby("site_id", group_keys=False)
    rain = w["precipitation_sum"].fillna(0)
    for days in (3, 7, 30):
        w[f"rain_{days}d_in"] = g["precipitation_sum"].transform(
            lambda s, d=days: s.fillna(0).rolling(d, min_periods=d).sum())
    w["days_since_rain"] = g["precipitation_sum"].transform(days_since_rain)
    w["heavy_rain_day"] = (rain >= 2.0).astype(int)
    w["month"] = w["date"].dt.month
    doy = w["date"].dt.dayofyear
    w["season_sin"] = np.sin(2 * np.pi * doy / 365.25)
    w["season_cos"] = np.cos(2 * np.pi * doy / 365.25)
    # The first 29 days of each site lack a full 30-day rain history.
    return w.dropna(subset=["rain_30d_in"]).reset_index(drop=True)


# ---------- storm event labels ----------

def load_events(storm_dir: Path) -> pd.DataFrame:
    files = sorted(storm_dir.glob("*.csv.gz"))
    if not files:
        raise SystemExit(f"No storm event files in {storm_dir}")
    ev = pd.concat([pd.read_csv(f, usecols=STORM_COLS, low_memory=False) for f in files], ignore_index=True)
    ev = ev[ev["EVENT_TYPE"].isin(EVENT_TO_GROUP) & ev["STATE"].isin(COORD_STATES)].copy()
    ev["group"] = ev["EVENT_TYPE"].map(EVENT_TO_GROUP)
    ev["begin"] = pd.to_datetime(ev["BEGIN_YEARMONTH"].astype(int) * 100 + ev["BEGIN_DAY"].astype(int), format="%Y%m%d")
    ev["end"] = pd.to_datetime(ev["END_YEARMONTH"].astype(int) * 100 + ev["END_DAY"].astype(int), format="%Y%m%d")
    ev["end"] = ev[["end", "begin"]].max(axis=1).clip(upper=ev["begin"] + pd.Timedelta(days=MAX_EVENT_DAYS - 1))
    return ev


def haversine_miles(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 3958.8 * 2 * np.arcsin(np.sqrt(a))


def words(text: str) -> list[str]:
    return re.sub(r"[^A-Z ]", " ", str(text).upper().replace("-", " ")).split()


def county_matches(county: str, zone_name: str) -> bool:
    """True if the site's county name appears as whole words in a NOAA zone/county name."""
    c, z = words(county), words(zone_name)
    return bool(c) and any(z[i:i + len(c)] == c for i in range(len(z) - len(c) + 1))


def match_events(sites: pd.DataFrame, ev: pd.DataFrame) -> pd.DataFrame:
    """Return (site_id, date, group) for every event that touches a site on a given day."""
    has_xy = ev["BEGIN_LAT"].notna() & ev["BEGIN_LON"].notna()
    point = ev[has_xy]
    area = ev[~has_xy & (ev["STATE"] == "FLORIDA") & (ev["CZ_TYPE"] != "M")]  # marine zones excluded
    hits = []
    for s in sites.itertuples():
        d_begin = haversine_miles(s.lat, s.lon, point["BEGIN_LAT"].to_numpy(), point["BEGIN_LON"].to_numpy())
        d_end = haversine_miles(s.lat, s.lon, point["END_LAT"].fillna(point["BEGIN_LAT"]).to_numpy(),
                                point["END_LON"].fillna(point["BEGIN_LON"]).to_numpy())
        near = point[np.minimum(d_begin, d_end) <= RADIUS_MILES]
        in_county = area[area["CZ_NAME"].map(lambda z, c=s.county: county_matches(c, z))]
        for e in pd.concat([near, in_county]).itertuples():
            for day in pd.date_range(e.begin, e.end, freq="D"):
                hits.append((s.site_id, day, e.group))
    return pd.DataFrame(hits, columns=["site_id", "date", "group"]).drop_duplicates()


def add_labels(table: pd.DataFrame, hits: pd.DataFrame) -> pd.DataFrame:
    for g in HAZARD_GROUPS:
        keys = hits.loc[hits["group"] == g, ["site_id", "date"]].assign(**{f"label_{g}": 1})
        table = table.merge(keys.drop_duplicates(), on=["site_id", "date"], how="left")
        table[f"label_{g}"] = table[f"label_{g}"].fillna(0).astype(int)
    table["label"] = table[[f"label_{g}" for g in HAZARD_GROUPS]].max(axis=1)
    return table


# ---------- main ----------

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sites", default=None, help="sites JSON with lat, lon, county")
    args = ap.parse_args()

    weather_dir, storm_dir = RAW / "weather", RAW / "storm_events"
    sites = load_sites(Path(args.sites) if args.sites else find_sites_file(), weather_dir)
    print(f"Sites with weather: {len(sites)}")

    table = add_features(load_weather(weather_dir, sites["site_id"].tolist()))
    table = table.merge(sites[["site_id", "lat", "lon"]], on="site_id")
    ev = load_events(storm_dir)
    print(f"Hazard events loaded (FL/GA/AL): {len(ev):,}")
    hits = match_events(sites, ev)
    table = add_labels(table, hits)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    table.to_csv(OUT, index=False)

    print(f"\nSaved {OUT}")
    print(f"Rows: {len(table):,}  |  Sites: {table['site_id'].nunique()}  |  "
          f"Dates: {table['date'].min().date()} to {table['date'].max().date()}")
    print(f"Label = 1 on {table['label'].mean():.1%} of site-days")
    print("By hazard group:", {g: f"{table[f'label_{g}'].mean():.1%}" for g in HAZARD_GROUPS})
    print("By year:", table.groupby(table["date"].dt.year)["label"].mean().map("{:.1%}".format).to_dict())


if __name__ == "__main__":
    main()