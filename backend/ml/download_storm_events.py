"""Download NOAA Storm Events 'details' files (labels for the hazard model).

Usage (from any folder, conda env active):
    python <path-to>/ml/download_storm_events.py --start 2015 --end 2024

Saves one .csv.gz per year to ml/data/raw/storm_events/ next to this script.
Skips years already downloaded, so it is safe to re-run.
"""
import argparse
import re
from pathlib import Path

import requests

BASE = "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/"
# Data is saved next to this script (…/ml/data/raw/storm_events), wherever the ml folder lives.
SCRIPT_DIR = Path(__file__).resolve().parent
OUT = SCRIPT_DIR / "data" / "raw" / "storm_events"


def newest_file_per_year(listing_html: str, start: int, end: int) -> dict[int, str]:
    """NOAA republishes files with a new 'c<date>' stamp; keep the newest per year."""
    names = set(re.findall(r"StormEvents_details-ftp_v1\.0_d(\d{4})_c(\d{8})\.csv\.gz", listing_html))
    newest: dict[int, str] = {}
    for year, stamp in sorted(names):
        y = int(year)
        if start <= y <= end:
            newest[y] = f"StormEvents_details-ftp_v1.0_d{year}_c{stamp}.csv.gz"  # sorted, so last wins
    return newest


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--start", type=int, default=2015)
    p.add_argument("--end", type=int, default=2024)
    args = p.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    listing = requests.get(BASE, timeout=60)
    listing.raise_for_status()
    files = newest_file_per_year(listing.text, args.start, args.end)

    missing = [y for y in range(args.start, args.end + 1) if y not in files]
    if missing:
        print(f"Warning: no file found for years {missing}")

    for year, name in files.items():
        dest = OUT / f"details_{year}.csv.gz"
        if dest.exists():
            print(f"{year}: already downloaded")
            continue
        print(f"{year}: downloading {name}")
        with requests.get(BASE + name, stream=True, timeout=300) as r:
            r.raise_for_status()
            tmp = dest.with_suffix(".part")
            with open(tmp, "wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
            tmp.rename(dest)
    print(f"Done. Files are in {OUT}/")


if __name__ == "__main__":
    main()
