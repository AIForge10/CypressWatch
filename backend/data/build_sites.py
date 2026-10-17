"""Build the real CypressWatch site list from EIA-860M (monthly U.S. power plant inventory).

Usage (from the repo root, conda env active):
    python backend/data/build_sites.py --month august --year 2026 --max-sites 60

Downloads the EIA-860M workbook, keeps operating plants in Florida, combines generators
into one row per plant, keeps the largest plants by total capacity, and writes
backend/data/sites/sites.json in the same shape as contracts/mocks/sites.json ("sites": [...]).
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests

DATA_DIR = Path(__file__).resolve().parent
OUT_DIR = DATA_DIR / "sites"
RAW_DIR = OUT_DIR / "raw"  # the downloaded workbook; large, keep it out of Git

URL_LATEST = "https://www.eia.gov/electricity/data/eia860m/xls/{month}_generator{year}.xlsx"
URL_ARCHIVE = "https://www.eia.gov/electricity/data/eia860m/archive/xls/{month}_generator{year}.xlsx"

# Florida Panhandle counties on Central time (Gulf County is split; treated as Central here).
CENTRAL_COUNTIES = {"ESCAMBIA", "SANTA ROSA", "OKALOOSA", "WALTON", "HOLMES",
                    "WASHINGTON", "BAY", "JACKSON", "CALHOUN", "GULF"}

# Column names we need, matched case-insensitively against the workbook's header row.
NEEDED = {
    "plant_id": ["plant id"],
    "plant_name": ["plant name"],
    "state": ["plant state", "state"],
    "county": ["county"],
    "lat": ["latitude"],
    "lon": ["longitude"],
    "technology": ["technology"],
    "capacity_mw": ["nameplate capacity (mw)", "net summer capacity (mw)"],
}


def download(month: str, year: int) -> Path:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    dest = RAW_DIR / f"{month}_generator{year}.xlsx"
    if dest.exists():
        print(f"Using cached {dest.name}")
        return dest
    for url in (URL_LATEST, URL_ARCHIVE):
        u = url.format(month=month, year=year)
        print(f"Downloading {u}")
        r = requests.get(u, timeout=300, headers={"User-Agent": "CypressWatch hackathon project"})
        if r.status_code == 200 and r.content[:2] == b"PK":  # xlsx files are zip archives
            dest.write_bytes(r.content)
            return dest
        print(f"  not found there (HTTP {r.status_code})")
    raise SystemExit(f"Could not download EIA-860M for {month} {year}. Check the month on "
                     "https://www.eia.gov/electricity/data/eia860m/")


def read_operating_sheet(path: Path) -> pd.DataFrame:
    """The 'Operating' sheet has title rows above the header; find the header row by its 'Plant ID' cell."""
    book = pd.ExcelFile(path)
    sheet = next((s for s in book.sheet_names if "operating" in s.lower()), None)
    if sheet is None:
        raise SystemExit(f"No 'Operating' sheet found. Sheets: {book.sheet_names}")
    preview = pd.read_excel(path, sheet_name=sheet, header=None, nrows=15)
    header_row = next((i for i, row in preview.iterrows()
                       if any(str(v).strip().lower() == "plant id" for v in row.values)), None)
    if header_row is None:
        raise SystemExit("Could not find the header row containing 'Plant ID'.")
    df = pd.read_excel(path, sheet_name=sheet, header=header_row)
    df.columns = [str(c).strip() for c in df.columns]

    lower = {c.lower(): c for c in df.columns}
    rename = {}
    for key, options in NEEDED.items():
        match = next((lower[o] for o in options if o in lower), None)
        if match is None:
            raise SystemExit(f"Column for '{key}' not found. Columns are: {list(df.columns)}")
        rename[match] = key
    return df[list(rename)].rename(columns=rename)


def simplify_type(technology: str) -> str:
    t = str(technology).lower()
    for words, label in [(["natural gas"], "natural gas"), (["solar"], "solar"), (["nuclear"], "nuclear"),
                         (["coal"], "coal"), (["petroleum"], "petroleum"), (["batter"], "battery storage"),
                         (["hydro"], "hydroelectric"), (["wind"], "wind"),
                         (["landfill", "wood", "biomass", "municipal", "waste"], "biomass")]:
        if any(w in t for w in words):
            return label
    return "other"


def build(df: pd.DataFrame, state: str, max_sites: int, min_mw: float) -> list[dict]:
    df = df[df["state"].astype(str).str.upper() == state].copy()
    df["capacity_mw"] = pd.to_numeric(df["capacity_mw"], errors="coerce").fillna(0)
    df["lat"] = pd.to_numeric(df["lat"], errors="coerce")
    df["lon"] = pd.to_numeric(df["lon"], errors="coerce")
    df = df.dropna(subset=["lat", "lon"])

    # One row per plant: total capacity, and the technology with the most capacity as its type.
    by_tech = df.groupby(["plant_id", "technology"], as_index=False)["capacity_mw"].sum()
    main_tech = by_tech.sort_values("capacity_mw").groupby("plant_id").tail(1).set_index("plant_id")["technology"]
    plants = df.groupby("plant_id").agg(plant_name=("plant_name", "first"), county=("county", "first"),
                                        lat=("lat", "first"), lon=("lon", "first"),
                                        capacity_mw=("capacity_mw", "sum")).reset_index()
    plants["technology"] = plants["plant_id"].map(main_tech)
    plants = plants[plants["capacity_mw"] >= min_mw].sort_values("capacity_mw", ascending=False).head(max_sites)

    sites = []
    for p in plants.itertuples():
        county = str(p.county).strip().title()
        sites.append({
            "site_id": f"site_{int(p.plant_id)}",
            "name": str(p.plant_name).strip(),
            "eia_plant_id": str(int(p.plant_id)),
            "plant_type": simplify_type(p.technology),
            "county": county,
            "state": state,
            "lat": round(float(p.lat), 4),
            "lon": round(float(p.lon), 4),
            "timezone": "America/Chicago" if county.upper() in CENTRAL_COUNTIES else "America/New_York",
            "capacity_mw": round(float(p.capacity_mw), 1),
        })
    return sites


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", default="august", help="lowercase month name of the EIA-860M release")
    ap.add_argument("--year", type=int, default=2026)
    ap.add_argument("--state", default="FL")
    ap.add_argument("--max-sites", type=int, default=60)
    ap.add_argument("--min-mw", type=float, default=0, help="skip plants smaller than this")
    ap.add_argument("--xlsx", default=None, help="use an already downloaded workbook instead")
    args = ap.parse_args()

    path = Path(args.xlsx) if args.xlsx else download(args.month.lower(), args.year)
    sites = build(read_operating_sheet(path), args.state.upper(), args.max_sites, args.min_mw)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / "sites.json"
    out.write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": f"EIA-860M {args.month.title()} {args.year} ({path.name}), Operating sheet",
        "sites": sites,
    }, indent=2) + "\n")

    types = pd.Series([s["plant_type"] for s in sites]).value_counts().to_dict()
    central = sum(s["timezone"] == "America/Chicago" for s in sites)
    print(f"Wrote {len(sites)} sites to {out}")
    print(f"Types: {types}")
    print(f"Central-time sites: {central}")


if __name__ == "__main__":
    main()