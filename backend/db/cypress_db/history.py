"""10 years of history in Tiger Data: compressed hypertable + pgvector "days like today".

Usage (from the repo root, after db.py setup/load):
    python backend/db/cypress_db/history.py load        # 10 years of site-days -> Tiger (compressed + vectors)
    python backend/db/cypress_db/history.py refresh     # find "days like today" for every site, save to Tiger
    python backend/db/cypress_db/history.py show site_6043
    python backend/db/cypress_db/history.py stats       # compression numbers for the README

From Python (scheduler after each scoring run, API for site detail):
    from cypress_db import history
    history.refresh_analogs()                 # every 15 min, after score.py
    history.get_analogs("site_6043")          # {"summary": "...", "analogs": [...], "event_rate": ..}

How it works:
  - weather_history: every past site-day (2015-2024, ~188k rows) in a hypertable with 90-day chunks, compressed.
  - history_vectors: the same days as 12-number weather fingerprints (pgvector), standardised so rain, gusts,
    heat and season count equally. Each row keeps what actually happened that day (NOAA storm reports).
  - For each site today we build the same fingerprint from the live forecast, then ask Tiger for the 10 nearest
    past days within 75 miles, and report how often those days had a storm, flood, heat or wind event.
"""
import argparse
import io
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/db
from cypress_db import db  # noqa: E402

BACKEND = db.BACKEND
TRAINING_TABLE = BACKEND / "ml" / "data" / "processed" / "training_table.csv.gz"
SAMPLE_SITES = BACKEND.parent / "contracts" / "mocks" / "sites.json"

VECTOR_FEATURES = ["temperature_2m_max", "apparent_temperature_max", "precipitation_sum", "precipitation_hours",
                   "wind_gusts_10m_max", "rain_3d_in", "rain_7d_in", "rain_30d_in", "days_since_rain",
                   "heavy_rain_day", "season_sin", "season_cos"]
LABELS = ["label_storm", "label_flood", "label_heat", "label_fire", "label_wind"]
LABEL_WORDS = {"label_storm": "thunderstorm", "label_flood": "flooding", "label_heat": "extreme heat",
               "label_fire": "wildfire", "label_wind": "high wind"}
PLURAL = {"thunderstorm": "thunderstorms", "flooding": "flooding", "extreme heat": "extreme heat",
          "wildfire": "wildfires", "high wind": "high winds"}
NEARBY_MILES, K = 75, 10
DAYS_SINCE_RAIN_CAP = 30


# ---------- schema ----------

def _has_pgvector() -> bool:
    with db.conn() as c:
        return c.execute("SELECT 1 FROM pg_extension WHERE extname = 'vector'").fetchone() is not None


def setup(verbose: bool = True) -> bool:
    """Create the history tables. Returns True if pgvector is used (else a plain-SQL distance fallback)."""
    try:
        with psycopg.connect(db.DATABASE_URL, autocommit=True) as c:
            c.execute("CREATE EXTENSION IF NOT EXISTS vector")
    except psycopg.Error as e:
        if verbose:
            print(f"  [--] pgvector not available ({str(e).splitlines()[0][:80]}); using SQL distance fallback")
    vec = _has_pgvector()
    emb_type = f"vector({len(VECTOR_FEATURES)})" if vec else "double precision[]"
    feature_cols = ", ".join(f"{f} REAL" for f in VECTOR_FEATURES)
    label_cols = ", ".join(f"{l} SMALLINT NOT NULL DEFAULT 0" for l in LABELS)
    with db.conn() as c:
        c.execute(f"""CREATE TABLE IF NOT EXISTS weather_history (
            day DATE NOT NULL, site_id TEXT NOT NULL, lat DOUBLE PRECISION, lon DOUBLE PRECISION,
            {feature_cols}, {label_cols}, label SMALLINT NOT NULL DEFAULT 0, PRIMARY KEY (site_id, day))""")
        c.execute(f"""CREATE TABLE IF NOT EXISTS history_vectors (
            site_id TEXT NOT NULL, day DATE NOT NULL, lat DOUBLE PRECISION NOT NULL, lon DOUBLE PRECISION NOT NULL,
            embedding {emb_type} NOT NULL, {label_cols}, label SMALLINT NOT NULL DEFAULT 0,
            PRIMARY KEY (site_id, day))""")
        c.execute("""CREATE TABLE IF NOT EXISTS history_scaler (
            feature TEXT PRIMARY KEY, mean DOUBLE PRECISION NOT NULL, std DOUBLE PRECISION NOT NULL)""")
        c.execute("""CREATE TABLE IF NOT EXISTS site_analogs (
            site_id TEXT PRIMARY KEY, for_date DATE NOT NULL, computed_at TIMESTAMPTZ NOT NULL,
            summary TEXT NOT NULL, event_rate REAL, base_rate REAL, analogs JSONB NOT NULL)""")
        c.execute("CREATE INDEX IF NOT EXISTS history_vectors_latlon ON history_vectors (lat, lon)")
        if not vec:
            c.execute("""CREATE OR REPLACE FUNCTION cw_l2(a double precision[], b double precision[])
                         RETURNS double precision LANGUAGE sql IMMUTABLE AS
                         $$ SELECT sqrt(sum((x - y) ^ 2)) FROM unnest(a, b) AS t(x, y) $$""")
    steps = [("hypertable weather_history (90-day chunks)",
              "SELECT create_hypertable('weather_history', 'day', chunk_time_interval => INTERVAL '90 days', "
              "if_not_exists => TRUE, migrate_data => TRUE)"),
             ("compression weather_history",
              "ALTER TABLE weather_history SET (timescaledb.compress, timescaledb.compress_segmentby = 'site_id', "
              "timescaledb.compress_orderby = 'day DESC')")]
    if vec:
        steps.append(("pgvector HNSW index on history_vectors",
                      "CREATE INDEX IF NOT EXISTS history_vectors_hnsw ON history_vectors "
                      "USING hnsw (embedding vector_l2_ops)"))
    for name, sql in steps:
        try:
            with psycopg.connect(db.DATABASE_URL, autocommit=True) as c:
                c.execute(sql)
            status = "ok"
        except psycopg.Error as e:
            status = str(e).strip().splitlines()[0][:100]
        if verbose:
            print(f"  [{'OK' if status == 'ok' else '--'}] {name}{'' if status == 'ok' else ': ' + status}")
    if verbose:
        print(f"  [OK] history tables ({'pgvector' if vec else 'SQL distance fallback'})")
    return vec


# ---------- loading 10 years ----------

def _vec_text(values) -> str:
    return "[" + ",".join(f"{v:.5f}" for v in values) + "]"


def load_history(path: Path = TRAINING_TABLE) -> dict:
    import pandas as pd
    vec = setup()
    t = pd.read_csv(path, parse_dates=["date"])
    if "lat" not in t.columns or "lon" not in t.columns:  # older tables: take coordinates from the sample sites
        sites = json.loads(SAMPLE_SITES.read_text())
        sites = pd.DataFrame(sites["sites"] if isinstance(sites, dict) else sites)[["site_id", "lat", "lon"]]
        t = t.merge(sites, on="site_id")
    for col in LABELS + ["label"]:
        if col not in t.columns:
            t[col] = 0
    t = t.dropna(subset=VECTOR_FEATURES).reset_index(drop=True)
    t["days_since_rain"] = t["days_since_rain"].clip(upper=DAYS_SINCE_RAIN_CAP)

    scaler = {f: (float(t[f].mean()), float(t[f].std() or 1.0)) for f in VECTOR_FEATURES}
    z = ((t[VECTOR_FEATURES] - [scaler[f][0] for f in VECTOR_FEATURES]) / [scaler[f][1] for f in VECTOR_FEATURES]).to_numpy()

    with db.conn() as c:
        c.execute("TRUNCATE weather_history, history_vectors, history_scaler")
        c.cursor().executemany("INSERT INTO history_scaler VALUES (%s, %s, %s)",
                               [(f, m, s) for f, (m, s) in scaler.items()])
        hist_cols = ["day", "site_id", "lat", "lon", *VECTOR_FEATURES, *LABELS, "label"]
        with c.cursor().copy(f"COPY weather_history ({', '.join(hist_cols)}) FROM STDIN") as cp:
            for r in t.itertuples(index=False):
                d = r._asdict()
                cp.write_row([d["date"].date(), d["site_id"], d["lat"], d["lon"],
                              *[d[f] for f in VECTOR_FEATURES], *[int(d[l]) for l in LABELS], int(d["label"])])
        vec_cols = ["site_id", "day", "lat", "lon", "embedding", *LABELS, "label"]
        with c.cursor().copy(f"COPY history_vectors ({', '.join(vec_cols)}) FROM STDIN") as cp:
            for i, r in enumerate(t.itertuples(index=False)):
                d = r._asdict()
                emb = _vec_text(z[i]) if vec else "{" + ",".join(f"{v:.5f}" for v in z[i]) + "}"
                cp.write_row([d["site_id"], d["date"].date(), d["lat"], d["lon"], emb,
                              *[int(d[l]) for l in LABELS], int(d["label"])])
    compressed = compress_history()
    return {"rows": len(t), "sites": t["site_id"].nunique(), "first_day": str(t["date"].min().date()),
            "last_day": str(t["date"].max().date()), "event_rate": round(float(t["label"].mean()), 4),
            "pgvector": vec, "compressed_chunks": compressed}


def compress_history() -> int:
    if not db.has_timescale():
        return 0
    try:
        with psycopg.connect(db.DATABASE_URL, autocommit=True) as c:
            rows = c.execute("SELECT compress_chunk(ch, if_not_compressed => true) "
                             "FROM show_chunks('weather_history') ch").fetchall()
        return len(rows)
    except psycopg.Error as e:
        print(f"  compression skipped: {str(e).splitlines()[0][:100]}")
        return 0


def compression_stats() -> dict | None:
    """Before/after size of the 10-year history (Tiger compression)."""
    if not db.has_timescale():
        return None
    with db.conn() as c:
        row = c.execute("""SELECT sum(before_compression_total_bytes) AS before, sum(after_compression_total_bytes) AS after,
                                  count(*) AS chunks
                           FROM chunk_compression_stats('weather_history') WHERE compression_status = 'Compressed'""").fetchone()
        rows = c.execute("SELECT count(*) AS n, min(day) AS first, max(day) AS last FROM weather_history").fetchone()
    if not row or not row["before"]:
        return {"rows": rows["n"], "compressed": False}
    before, after = int(row["before"]), int(row["after"])
    return {"rows": rows["n"], "first_day": rows["first"].isoformat(), "last_day": rows["last"].isoformat(),
            "chunks_compressed": row["chunks"], "before_mb": round(before / 1e6, 2), "after_mb": round(after / 1e6, 2),
            "reduction_pct": round(100 * (1 - after / before), 1)}


# ---------- days like today ----------

def _scaler() -> dict:
    with db.conn() as c:
        return {r["feature"]: (r["mean"], r["std"]) for r in c.execute("SELECT * FROM history_scaler").fetchall()}


# def find_analogs(lat: float, lon: float, features: dict, k: int = K, miles: float = NEARBY_MILES) -> dict:
#     """The k past days most like `features` within `miles` of (lat, lon), and what happened on them."""
#     scaler = _scaler()
#     if not scaler:
#         raise RuntimeError("No history loaded. Run: python backend/db/cypress_db/history.py load")
#     feats = dict(features)
#     feats["days_since_rain"] = min(float(feats["days_since_rain"]), DAYS_SINCE_RAIN_CAP)
#     z = [(float(feats[f]) - scaler[f][0]) / scaler[f][1] for f in VECTOR_FEATURES]
#     vec = _has_pgvector()
#     dist = "embedding <-> %(q)s::vector" if vec else "cw_l2(embedding, %(q)s)"
#     params = {"q": _vec_text(z) if vec else z, "lat": lat, "lon": lon, "miles": miles, "k": k}
#     near = db._near_box("lat", "lon", "%(lat)s", "%(lon)s", "%(miles)s")
#     labels = ", ".join(LABELS)
#     with db.conn() as c:
#         # Filter to nearby site-days FIRST (materialized), then exact vector search on that set.
#         rows = c.execute(f"""WITH nearby AS MATERIALIZED (
#                                  SELECT * FROM history_vectors WHERE {near})
#                              SELECT site_id, day, label, {labels}, {dist} AS distance,
#                                     {db._distance_sql('lat', 'lon', '%(lat)s', '%(lon)s')} AS miles_away
#                              FROM nearby ORDER BY {dist} LIMIT %(k)s""", params).fetchall()
#         scope = f"within {miles:.0f} miles"
#         if len(rows) < k:  # no historical sites close by: search all of Florida
#             rows = c.execute(f"""SELECT site_id, day, label, {labels}, {dist} AS distance, NULL AS miles_away
#                                  FROM history_vectors ORDER BY {dist} LIMIT %(k)s""", params).fetchall()
#             scope = "across Florida"
#             base = c.execute("SELECT avg(label) AS r FROM history_vectors").fetchone()["r"]
#         else:
#             base = c.execute(f"SELECT avg(label) AS r FROM history_vectors WHERE {near}", params).fetchone()["r"]
#     analogs = [{"day": r["day"].isoformat(), "site_id": r["site_id"], "similarity": round(1 / (1 + r["distance"]), 3),
#                 "events": [LABEL_WORDS[l] for l in LABELS if r[l]], "had_event": bool(r["label"])} for r in rows]
#     hits = sum(a["had_event"] for a in analogs)
#     rate, base = (hits / len(analogs) if analogs else 0.0), float(base or 0)
#     return {"analogs": analogs, "events_in_analogs": hits, "event_rate": round(rate, 3), "base_rate": round(base, 3),
#             "scope": scope, "summary": _summary(analogs, hits, rate, base, scope)}

def find_analogs(lat: float, lon: float, features: dict, k: int = K, miles: float = NEARBY_MILES) -> dict:
    """The k past DAYS most like `features` within `miles` of (lat, lon), and what happened on them.
    A day that matches at several nearby historical sites counts once (its best match)."""
    scaler = _scaler()
    if not scaler:
        raise RuntimeError("No history loaded. Run: python backend/db/cypress_db/history.py load")
    feats = dict(features)
    feats["days_since_rain"] = min(float(feats["days_since_rain"]), DAYS_SINCE_RAIN_CAP)
    z = [(float(feats[f]) - scaler[f][0]) / scaler[f][1] for f in VECTOR_FEATURES]
    vec = _has_pgvector()
    dist = "embedding <-> %(q)s::vector" if vec else "cw_l2(embedding, %(q)s)"
    params = {"q": _vec_text(z) if vec else z, "lat": lat, "lon": lon, "miles": miles, "pool": k * 6}
    near = db._near_box("lat", "lon", "%(lat)s", "%(lon)s", "%(miles)s")
    labels = ", ".join(LABELS)

    def distinct_days(rows):
        seen, out = set(), []
        for r in rows:
            if r["day"] not in seen:
                seen.add(r["day"])
                out.append(r)
        return out[:k]

    with db.conn() as c:
        # Filter to nearby site-days FIRST (materialized), then exact vector search on that set.
        rows = distinct_days(c.execute(f"""WITH nearby AS MATERIALIZED (
                                 SELECT * FROM history_vectors WHERE {near})
                             SELECT site_id, day, label, {labels}, {dist} AS distance
                             FROM nearby ORDER BY {dist} LIMIT %(pool)s""", params).fetchall())
        scope = f"within {miles:.0f} miles"
        if len(rows) < k:  # no historical sites close by: search all of Florida (uses the HNSW index)
            rows = distinct_days(c.execute(f"""SELECT site_id, day, label, {labels}, {dist} AS distance
                                 FROM history_vectors ORDER BY {dist} LIMIT %(pool)s""", params).fetchall())
            scope = "across Florida"
            base = c.execute("SELECT avg(label) AS r FROM history_vectors").fetchone()["r"]
        else:
            base = c.execute(f"SELECT avg(label) AS r FROM history_vectors WHERE {near}", params).fetchone()["r"]
    analogs = [{"day": r["day"].isoformat(), "site_id": r["site_id"], "similarity": round(1 / (1 + r["distance"]), 3),
                "events": [LABEL_WORDS[l] for l in LABELS if r[l]], "had_event": bool(r["label"])} for r in rows]
    hits = sum(a["had_event"] for a in analogs)
    rate, base = (hits / len(analogs) if analogs else 0.0), float(base or 0)
    return {"analogs": analogs, "events_in_analogs": hits, "event_rate": round(rate, 3), "base_rate": round(base, 3),
            "scope": scope, "summary": _summary(analogs, hits, rate, base, scope)}


def _fmt_day(iso: str) -> str:
    d = datetime.fromisoformat(iso)
    return f"{d:%b} {d.day}, {d.year}"


def _summary(analogs: list, hits: int, rate: float, base: float, scope: str) -> str:
    if not analogs:
        return "No similar past days found."
    n = len(analogs)
    text = f"Today looks like {n} past days {scope} (2015–2024). "
    if hits:
        kinds = sorted({e for a in analogs for e in a["events"]})
        kinds = [PLURAL.get(k, k) for k in kinds]
        what = kinds[0] if len(kinds) == 1 else ", ".join(kinds[:-1]) + " or " + kinds[-1]
        text += f"On {hits} of them, {what} {'was' if kinds == ['flooding'] or kinds == ['extreme heat'] else 'were'} reported within 25 miles"
        if base > 0 and rate >= 2 * base:
            text += f", about {rate / base:.0f}x the usual rate"
        first = next(a for a in analogs if a["had_event"])
        text += f". Closest match with an event: {_fmt_day(first['day'])} ({', '.join(first['events'])})."
    else:
        text += f"None of them had a reported hazard event. Closest match: {_fmt_day(analogs[0]['day'])}."
    return text


def today_features(snapshot: dict | None = None, sites: list | None = None) -> dict:
    """Today's 12 fingerprint numbers per site, built from the live forecast with the same code as training."""
    sys.path.insert(0, str(BACKEND / "ml" / "src"))
    from cypress_ml.score import live_feature_rows
    snapshot = snapshot or json.loads((db.LIVE / "weather_latest.json").read_text())
    if sites is None:
        sj = json.loads(db.SITES_FILE.read_text())
        sites = sj["sites"] if isinstance(sj, dict) else sj
    rows = live_feature_rows(snapshot, sites, days=(0,))
    out = {}
    for r in rows.to_dict("records"):
        out[r["site_id"]] = {"date": r["date"].date().isoformat(), "lat": r["lat"], "lon": r["lon"],
                             **{f: r[f] for f in VECTOR_FEATURES}}
    return out


def refresh_analogs(snapshot: dict | None = None) -> int:
    """Compute and store "days like today" for every site (call after each scoring run)."""
    feats = today_features(snapshot)
    now = datetime.now(timezone.utc)
    rows = []
    for site_id, f in feats.items():
        res = find_analogs(f["lat"], f["lon"], f)
        rows.append((site_id, f["date"], now, res["summary"], res["event_rate"], res["base_rate"],
                     db.Jsonb({k: res[k] for k in ("analogs", "events_in_analogs", "scope")})))
    with db.conn() as c:
        c.cursor().executemany(
            "INSERT INTO site_analogs (site_id, for_date, computed_at, summary, event_rate, base_rate, analogs) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT (site_id) DO UPDATE SET for_date = EXCLUDED.for_date, "
            "computed_at = EXCLUDED.computed_at, summary = EXCLUDED.summary, event_rate = EXCLUDED.event_rate, "
            "base_rate = EXCLUDED.base_rate, analogs = EXCLUDED.analogs", rows)
    return len(rows)


def get_analogs(site_id: str) -> dict | None:
    """Stored "days like today" for one site (for the site detail endpoint)."""
    with db.conn() as c:
        row = c.execute("SELECT * FROM site_analogs WHERE site_id = %s", (site_id,)).fetchone()
    if not row:
        return None
    return {"for_date": row["for_date"].isoformat(), "computed_at": db._iso(row["computed_at"]),
            "summary": row["summary"], "event_rate": row["event_rate"], "base_rate": row["base_rate"],
            **row["analogs"]}


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    ld = sub.add_parser("load")
    ld.add_argument("--file", default=str(TRAINING_TABLE))
    sub.add_parser("refresh")
    sh = sub.add_parser("show")
    sh.add_argument("site_id")
    sub.add_parser("stats")
    args = ap.parse_args()

    if args.cmd == "load":
        print("Loading 10 years of history into Tiger Data (takes a minute)")
        print(f"  {load_history(Path(args.file))}")
        print(f"  compression: {compression_stats()}")
    elif args.cmd == "refresh":
        print(f"Days like today computed for {refresh_analogs()} sites")
    elif args.cmd == "show":
        a = get_analogs(args.site_id)
        if not a:
            print("Nothing stored yet. Run: refresh")
            return
        print(a["summary"])
        for x in a["analogs"]:
            print(f"  {x['day']}  similarity {x['similarity']}  {', '.join(x['events']) or 'no event'}  ({x['site_id']})")
    elif args.cmd == "stats":
        print(json.dumps(compression_stats(), indent=1))


if __name__ == "__main__":
    main()