"""Tiger Data (TimescaleDB) storage for CypressWatch: schema, writes, and the queries the API needs.

Setup (from the repo root, conda env active; DATABASE_URL in backend/api/.env):
    python backend/db/cypress_db/db.py setup            # tables, hypertables, continuous aggregates, policies
    python backend/db/cypress_db/db.py load             # sites + latest weather/scores/briefings
    python backend/db/cypress_db/db.py load --archive   # also replay today's archived weather runs (history + drift)
    python backend/db/cypress_db/db.py check            # print what the API will serve
    python backend/db/cypress_db/db.py strike site_6043 # DEMO: simulated lightning strike 4 mi from a site

From Python (API routers, scheduler):
    import sys; sys.path.insert(0, "backend/db")
    from cypress_db import db
    db.save_weather(snapshot); db.save_scores(scores); db.save_briefing(result); db.save_strikes([...])
    db.ranked_sites()            -> sites with latest score, ranked        (GET /api/sites)
    db.site_score(site_id)       -> latest score + explanation             (GET /api/sites/{id})
    db.stop_work_status(site_id) -> strikes within 10 mi in 30 min         (stop-work + StopWork contract)
    db.site_history(site_id, 48) -> hourly chart series                    (GET /api/sites/{id}/history)
    db.forecast_drift(site_id)   -> how a forecast hour changed over time  (site detail "forecast_drift")
    db.get_briefing(site_id, date, "en")                                   (GET /api/sites/{id}/briefing)

Why Tiger Data:
  - Hypertables split weather, forecasts, scores and strikes into daily chunks, so "last 48 hours" reads only 2 chunks.
  - Continuous aggregates keep hourly risk and weather summaries up to date for the charts (real-time, no cron).
  - Every forecast run is kept, so we can show forecast drift ("3 PM rain chance rose from 20% to 60%").
  - Compression after 7 days and retention policies keep storage small without any app code.
"""
import argparse
import atexit
import json
import math
import os
import sys
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

BACKEND = Path(__file__).resolve().parents[2]
for env_file in (BACKEND / "api" / ".env", BACKEND.parent / ".env", BACKEND / ".env"):
    if env_file.exists():
        try:
            from dotenv import load_dotenv
            load_dotenv(env_file)
        except ImportError:
            pass
        break

DATABASE_URL = os.environ.get("DATABASE_URL") or os.environ.get("TIGER_DATABASE_URL")
LIVE = BACKEND / "workers" / "data" / "live"
SITES_FILE = BACKEND / "data" / "sites" / "sites.json"
STOP_WORK_MILES, STOP_WORK_MINUTES = 10, 30
EARTH_MILES = 3958.8

# ---------- connection ----------

_pool = None


def _get_pool():
    global _pool
    if _pool is None:
        try:
            from psycopg_pool import ConnectionPool
        except ImportError:
            return None
        _pool = ConnectionPool(DATABASE_URL, min_size=1, max_size=5, kwargs={"row_factory": dict_row}, open=True)
    return _pool


def close() -> None:
    """Close the connection pool (called automatically at exit)."""
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


atexit.register(close)


@contextmanager
def conn():
    """One connection from the pool (commits on success, rolls back on error)."""
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not set. Put the Tiger connection string in backend/api/.env")
    pool = _get_pool()
    if pool is None:
        with psycopg.connect(DATABASE_URL, row_factory=dict_row) as c:
            yield c
    else:
        with pool.connection() as c:
            yield c


@lru_cache(maxsize=1)
def has_timescale() -> bool:
    with conn() as c:
        return c.execute("SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'").fetchone() is not None


@lru_cache(maxsize=None)
def has_view(name: str) -> bool:
    """True if a continuous aggregate (or any view) with this name exists."""
    with conn() as c:
        return c.execute("SELECT 1 FROM pg_class WHERE relname = %s", (name,)).fetchone() is not None


# ---------- schema ----------

CORE_SQL = [
    """CREATE TABLE IF NOT EXISTS sites (
        site_id TEXT PRIMARY KEY, name TEXT NOT NULL, eia_plant_id TEXT, plant_type TEXT, county TEXT, state TEXT,
        lat DOUBLE PRECISION NOT NULL, lon DOUBLE PRECISION NOT NULL, timezone TEXT NOT NULL, capacity_mw DOUBLE PRECISION)""",
    """CREATE TABLE IF NOT EXISTS weather_obs (
        time TIMESTAMPTZ NOT NULL, site_id TEXT NOT NULL, temperature_f REAL, humidity_pct REAL,
        apparent_temperature_f REAL, heat_index_f REAL, precipitation_in REAL, wind_gust_mph REAL,
        weather_code SMALLINT, source TEXT NOT NULL DEFAULT 'open-meteo', fetched_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (site_id, time))""",
    """CREATE TABLE IF NOT EXISTS forecast_hourly (
        issued_at TIMESTAMPTZ NOT NULL, site_id TEXT NOT NULL, valid_at TIMESTAMPTZ NOT NULL,
        temperature_f REAL, heat_index_f REAL, precipitation_probability_pct REAL, precipitation_in REAL,
        wind_gust_mph REAL, weather_code SMALLINT, PRIMARY KEY (site_id, valid_at, issued_at))""",
    """CREATE TABLE IF NOT EXISTS site_scores (
        scored_at TIMESTAMPTZ NOT NULL, site_id TEXT NOT NULL, day_offset SMALLINT NOT NULL, date DATE NOT NULL,
        hazard_score REAL NOT NULL, risk_level TEXT NOT NULL, model_probability REAL, model_version TEXT NOT NULL,
        top_factors JSONB NOT NULL DEFAULT '[]', explanation TEXT, explanation_source TEXT,
        weather_fetched_at TIMESTAMPTZ, PRIMARY KEY (site_id, day_offset, scored_at))""",
    """CREATE TABLE IF NOT EXISTS lightning_strikes (
        time TIMESTAMPTZ NOT NULL, lat DOUBLE PRECISION NOT NULL, lon DOUBLE PRECISION NOT NULL,
        source TEXT NOT NULL DEFAULT 'goes-glm', energy DOUBLE PRECISION, simulated BOOLEAN NOT NULL DEFAULT FALSE)""",
    "CREATE INDEX IF NOT EXISTS lightning_strikes_time_idx ON lightning_strikes (time DESC)",
    """CREATE TABLE IF NOT EXISTS briefings (
        site_id TEXT NOT NULL, for_date DATE NOT NULL, language TEXT NOT NULL, generated_at TIMESTAMPTZ NOT NULL,
        validated BOOLEAN NOT NULL, source TEXT, body JSONB NOT NULL, PRIMARY KEY (site_id, for_date, language))""",
    """CREATE TABLE IF NOT EXISTS reports (
        report_id TEXT PRIMARY KEY, client_id TEXT NOT NULL UNIQUE, site_id TEXT NOT NULL,
        lat DOUBLE PRECISION, lon DOUBLE PRECISION, note TEXT NOT NULL DEFAULT '', photo_url TEXT,
        captured_at TIMESTAMPTZ NOT NULL, uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(), reported_by JSONB NOT NULL,
        triage JSONB, status TEXT NOT NULL DEFAULT 'pending_review', confirmed_hazard TEXT,
        confirmed_severity TEXT, ledger_record_id TEXT)""",
    "CREATE INDEX IF NOT EXISTS reports_site_idx ON reports (site_id, uploaded_at DESC)",
]

# TimescaleDB features. Each runs on its own, so one unsupported option never breaks setup.
TIMESCALE_SQL = [
    ("timescaledb extension", "CREATE EXTENSION IF NOT EXISTS timescaledb"),
    *[(f"hypertable {t}", f"SELECT create_hypertable('{t}', '{col}', chunk_time_interval => INTERVAL '1 day', "
                         f"if_not_exists => TRUE, migrate_data => TRUE)")
      for t, col in (("weather_obs", "time"), ("forecast_hourly", "issued_at"),
                     ("site_scores", "scored_at"), ("lightning_strikes", "time"))],
    ("continuous aggregate site_risk_hourly", """
        CREATE MATERIALIZED VIEW IF NOT EXISTS site_risk_hourly
        WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
        SELECT time_bucket(INTERVAL '1 hour', scored_at) AS bucket, site_id,
               max(hazard_score) AS max_score, avg(hazard_score) AS avg_score, count(*) AS runs
        FROM site_scores WHERE day_offset = 0 GROUP BY bucket, site_id WITH NO DATA"""),
    ("continuous aggregate weather_hourly", """
        CREATE MATERIALIZED VIEW IF NOT EXISTS weather_hourly
        WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
        SELECT time_bucket(INTERVAL '1 hour', time) AS bucket, site_id,
               max(heat_index_f) AS max_heat_index_f, max(wind_gust_mph) AS max_gust_mph,
               max(precipitation_in) AS max_precip_in
        FROM weather_obs GROUP BY bucket, site_id WITH NO DATA"""),
    *[(f"refresh policy {v}", f"SELECT add_continuous_aggregate_policy('{v}', start_offset => INTERVAL '3 days', "
                              f"end_offset => INTERVAL '1 hour', schedule_interval => INTERVAL '15 minutes', "
                              f"if_not_exists => TRUE)")
      for v in ("site_risk_hourly", "weather_hourly")],
    *[(f"compression {t}", f"ALTER TABLE {t} SET (timescaledb.compress, timescaledb.compress_segmentby = 'site_id', "
                           f"timescaledb.compress_orderby = '{order}')")
      for t, order in (("weather_obs", "time DESC"), ("forecast_hourly", "valid_at DESC, issued_at DESC"),
                       ("site_scores", "scored_at DESC"))],
    *[(f"compression policy {t}", f"SELECT add_compression_policy('{t}', INTERVAL '7 days', if_not_exists => TRUE)")
      for t in ("weather_obs", "forecast_hourly", "site_scores")],
    ("retention forecast_hourly 30 days",
     "SELECT add_retention_policy('forecast_hourly', INTERVAL '30 days', if_not_exists => TRUE)"),
    ("retention lightning_strikes 90 days",
     "SELECT add_retention_policy('lightning_strikes', INTERVAL '90 days', if_not_exists => TRUE)"),
]


def setup_schema(verbose: bool = True) -> list[tuple[str, str]]:
    """Create everything. Safe to run again. Returns [(step, "ok" | error)]."""
    results = []
    with conn() as c:
        for sql in CORE_SQL:
            c.execute(sql)
    results.append(("core tables", "ok"))
    for name, sql in TIMESCALE_SQL:
        try:
            with psycopg.connect(DATABASE_URL, autocommit=True) as c:  # caggs can't be created inside a transaction
                c.execute(sql)
            results.append((name, "ok"))
        except psycopg.Error as e:
            results.append((name, (str(e).strip().splitlines() or ["error"])[0][:120]))
    has_timescale.cache_clear()
    has_view.cache_clear()
    if verbose:
        for name, status in results:
            print(f"  [{'OK' if status == 'ok' else '--'}] {name}{'' if status == 'ok' else ': ' + status}")
    return results


# ---------- helpers ----------

def _utc(local_iso: str | None, tz: str) -> datetime | None:
    """Open-Meteo gives local times without an offset ("2026-10-17T17:00"); store them as UTC."""
    if not local_iso:
        return None
    return datetime.fromisoformat(local_iso).replace(tzinfo=ZoneInfo(tz)).astimezone(timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if dt else None


def _parse_ts(value) -> datetime | None:
    if value is None or isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _distance_sql(lat: str, lon: str, slat: str, slon: str) -> str:
    """Great-circle distance in miles (haversine), in SQL."""
    return (f"({EARTH_MILES} * 2 * asin(sqrt(power(sin(radians({lat} - {slat}) / 2), 2) + "
            f"cos(radians({slat})) * cos(radians({lat})) * power(sin(radians({lon} - {slon}) / 2), 2))))")


def _near_box(lat: str, lon: str, slat: str, slon: str, miles: str) -> str:
    """Cheap bounding box first, so the distance math only runs on nearby strikes."""
    return (f"abs({lat} - {slat}) <= {miles} / 69.0 AND "
            f"abs({lon} - {slon}) <= {miles} / (69.0 * cos(radians({slat})))")


def _clean(row: dict) -> dict:
    """Make a row JSON-ready: datetimes to ISO Z strings, dates to ISO dates."""
    out = {}
    for k, v in row.items():
        if isinstance(v, datetime):
            out[k] = _iso(v)
        elif hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


# ---------- writes ----------

def upsert_sites(sites: list[dict]) -> int:
    cols = ("site_id", "name", "eia_plant_id", "plant_type", "county", "state", "lat", "lon", "timezone", "capacity_mw")
    rows = [tuple(str(s[c]) if c == "eia_plant_id" and s.get(c) is not None else s.get(c) for c in cols) for s in sites]
    with conn() as c:
        c.cursor().executemany(
            f"INSERT INTO sites ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))}) "
            f"ON CONFLICT (site_id) DO UPDATE SET {', '.join(f'{c} = EXCLUDED.{c}' for c in cols[1:])}", rows)
    return len(rows)


def save_weather(snapshot: dict) -> dict:
    """Current conditions -> weather_obs, every hourly forecast row -> forecast_hourly (issued_at = fetched_at)."""
    issued = _parse_ts(snapshot["fetched_at"])
    obs, fc = [], []
    for rec in snapshot["sites"]:
        tz, cur = rec.get("timezone") or "America/New_York", rec.get("current") or {}
        t = _utc(cur.get("observed_at_local"), tz)
        if t:
            obs.append((t, rec["site_id"], cur.get("temperature_f"), cur.get("humidity_pct"),
                        cur.get("apparent_temperature_f"), cur.get("heat_index_f"), cur.get("precipitation_in"),
                        cur.get("wind_gust_mph"), cur.get("weather_code"), rec.get("source", "open-meteo"), issued))
        for h in rec.get("hourly") or []:
            valid = _utc(h["time"], tz)
            if valid and valid >= issued - timedelta(hours=1):  # keep only hours still ahead of this forecast run
                fc.append((issued, rec["site_id"], valid, h.get("temperature_2m"), h.get("heat_index_f"),
                           h.get("precipitation_probability"), h.get("precipitation"), h.get("wind_gusts_10m"),
                           h.get("weather_code")))
    with conn() as c:
        cur = c.cursor()
        cur.executemany(
            "INSERT INTO weather_obs (time, site_id, temperature_f, humidity_pct, apparent_temperature_f, heat_index_f, "
            "precipitation_in, wind_gust_mph, weather_code, source, fetched_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT (site_id, time) DO UPDATE SET "
            "temperature_f = EXCLUDED.temperature_f, humidity_pct = EXCLUDED.humidity_pct, "
            "apparent_temperature_f = EXCLUDED.apparent_temperature_f, heat_index_f = EXCLUDED.heat_index_f, "
            "precipitation_in = EXCLUDED.precipitation_in, wind_gust_mph = EXCLUDED.wind_gust_mph, "
            "weather_code = EXCLUDED.weather_code, fetched_at = EXCLUDED.fetched_at", obs)
        cur.executemany(
            "INSERT INTO forecast_hourly (issued_at, site_id, valid_at, temperature_f, heat_index_f, "
            "precipitation_probability_pct, precipitation_in, wind_gust_mph, weather_code) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING", fc)
    return {"weather_obs": len(obs), "forecast_hourly": len(fc)}


def save_scores(scores: list[dict], scored_at: str | datetime | None = None) -> int:
    rows = [(_parse_ts(scored_at or s["scored_at"]), s["site_id"], s["day_offset"], s["date"], s["hazard_score"],
             s["risk_level"], s.get("model_probability"), s["model_version"], Jsonb(s.get("top_factors") or []),
             s.get("explanation"), s.get("explanation_source"), _parse_ts(s.get("weather_fetched_at")))
            for s in scores]
    with conn() as c:
        c.cursor().executemany(
            "INSERT INTO site_scores (scored_at, site_id, day_offset, date, hazard_score, risk_level, model_probability, "
            "model_version, top_factors, explanation, explanation_source, weather_fetched_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT (site_id, day_offset, scored_at) "
            "DO UPDATE SET explanation = EXCLUDED.explanation, explanation_source = EXCLUDED.explanation_source", rows)
    return len(rows)


def save_strikes(strikes: list[dict]) -> int:
    """strikes: [{"time": ISO or datetime, "lat": .., "lon": .., "source"?: "goes-glm", "energy"?: .., "simulated"?: bool}]"""
    rows = [(_parse_ts(s["time"]), s["lat"], s["lon"], s.get("source", "goes-glm"), s.get("energy"),
             bool(s.get("simulated", False))) for s in strikes]
    with conn() as c:
        c.cursor().executemany("INSERT INTO lightning_strikes (time, lat, lon, source, energy, simulated) "
                               "VALUES (%s, %s, %s, %s, %s, %s)", rows)
    return len(rows)


def save_briefing(result: dict) -> int:
    """result from cypress_ai.briefing.generate_briefing (has "en" and "es")."""
    rows = [(result["site_id"], result["for_date"], lang, _parse_ts(result[lang]["generated_at"]),
             bool(result[lang].get("validated")), result.get("source"), Jsonb(result[lang]))
            for lang in ("en", "es") if lang in result]
    with conn() as c:
        c.cursor().executemany(
            "INSERT INTO briefings (site_id, for_date, language, generated_at, validated, source, body) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT (site_id, for_date, language) DO UPDATE SET "
            "generated_at = EXCLUDED.generated_at, validated = EXCLUDED.validated, source = EXCLUDED.source, "
            "body = EXCLUDED.body", rows)
    return len(rows)


REPORT_COLS = ("report_id", "client_id", "site_id", "lat", "lon", "note", "photo_url", "captured_at", "uploaded_at",
               "reported_by", "triage", "status", "confirmed_hazard", "confirmed_severity", "ledger_record_id")


def save_report(report: dict) -> tuple[dict, bool]:
    """Insert a crew report (contract Report). Returns (report, created). Same client_id twice = offline replay:
    the existing report is returned with created=False (the API answers 409 duplicate)."""
    vals = {k: report.get(k) for k in REPORT_COLS}
    vals["reported_by"] = Jsonb(vals["reported_by"] or {})
    vals["triage"] = Jsonb(vals["triage"]) if vals["triage"] is not None else None
    vals["status"] = vals["status"] or "pending_review"
    vals["uploaded_at"] = vals["uploaded_at"] or datetime.now(timezone.utc)
    with conn() as c:
        row = c.execute(f"INSERT INTO reports ({', '.join(REPORT_COLS)}) VALUES ({', '.join('%(' + k + ')s' for k in REPORT_COLS)}) "
                        "ON CONFLICT (client_id) DO NOTHING RETURNING *", vals).fetchone()
        if row:
            return _clean(row), True
        return _clean(c.execute("SELECT * FROM reports WHERE client_id = %s", (vals["client_id"],)).fetchone()), False


def update_report(report_id: str, **fields) -> dict | None:
    """e.g. update_report("rpt_91c2", triage={...}) or status="confirmed", confirmed_hazard=..., ledger_record_id=..."""
    allowed = {k: (Jsonb(v) if k == "triage" and v is not None else v) for k, v in fields.items()
               if k in ("triage", "status", "confirmed_hazard", "confirmed_severity", "ledger_record_id", "photo_url")}
    if not allowed:
        return get_report(report_id)
    sets = ", ".join(f"{k} = %({k})s" for k in allowed)
    with conn() as c:
        row = c.execute(f"UPDATE reports SET {sets} WHERE report_id = %(report_id)s RETURNING *",
                        allowed | {"report_id": report_id}).fetchone()
    return _clean(row) if row else None


# ---------- reads ----------

def _site(site_id: str) -> dict | None:
    with conn() as c:
        return c.execute("SELECT * FROM sites WHERE site_id = %s", (site_id,)).fetchone()


def ranked_sites(day_offset: int = 0, max_age_hours: int = 48) -> list[dict]:
    """Every site with its latest score, highest risk first, with rank (GET /api/sites)."""
    with conn() as c:
        rows = c.execute(
            """SELECT s.*, sc.hazard_score, sc.risk_level, sc.top_factors, sc.explanation, sc.model_version,
                      sc.scored_at, sc.date
               FROM sites s
               LEFT JOIN LATERAL (
                   SELECT * FROM site_scores x
                   WHERE x.site_id = s.site_id AND x.day_offset = %s AND x.scored_at > now() - make_interval(hours => %s)
                   ORDER BY x.scored_at DESC LIMIT 1) sc ON TRUE""", (day_offset, max_age_hours)).fetchall()
    rows.sort(key=lambda r: -(r["hazard_score"] if r["hazard_score"] is not None else -1))
    out = []
    for i, r in enumerate(rows, 1):
        r = _clean(r)
        r["rank"] = i
        r["top_hazard"] = top_hazard(r.get("top_factors"))
        out.append(r)
    return out


FEATURE_HAZARD = {"lightning_stop_work": "lightning", "precipitation_sum": "flood", "precipitation_hours": "flood",
                  "rain_3d_in": "flood", "rain_7d_in": "soil_saturation", "rain_30d_in": "soil_saturation",
                  "heavy_rain_day": "flood", "days_since_rain": "flood", "wind_gusts_10m_max": "storm",
                  "apparent_temperature_max": "heat", "temperature_2m_max": "heat"}


def top_hazard(top_factors: list | None) -> str | None:
    """The hazard behind the strongest weather reason (location/season are skipped)."""
    for f in top_factors or []:
        if f.get("feature") in FEATURE_HAZARD:
            return FEATURE_HAZARD[f["feature"]]
    return None


def site_score(site_id: str, day_offset: int = 0) -> dict | None:
    """Latest score block for one site (matches the `score` part of site_detail.json)."""
    with conn() as c:
        row = c.execute("SELECT * FROM site_scores WHERE site_id = %s AND day_offset = %s "
                        "AND scored_at > now() - INTERVAL '7 days' ORDER BY scored_at DESC LIMIT 1",
                        (site_id, day_offset)).fetchone()
    return _clean(row) if row else None


def latest_conditions(site_id: str) -> dict | None:
    with conn() as c:
        row = c.execute("SELECT * FROM weather_obs WHERE site_id = %s AND time > now() - INTERVAL '2 days' "
                        "ORDER BY time DESC LIMIT 1", (site_id,)).fetchone()
    if not row:
        return None
    return {"temperature_f": row["temperature_f"], "heat_index_f": row["heat_index_f"],
            "humidity_pct": row["humidity_pct"], "wind_gust_mph": row["wind_gust_mph"],
            "precipitation_in": row["precipitation_in"], "weather_code": row["weather_code"],
            "source": row["source"], "observed_at": _iso(row["time"])}


def strikes_near(site_id: str, miles: float = STOP_WORK_MILES, minutes: int = STOP_WORK_MINUTES) -> list[dict]:
    """Strikes within `miles` of the site in the last `minutes`, nearest first."""
    dist = _distance_sql("l.lat", "l.lon", "s.lat", "s.lon")
    with conn() as c:
        rows = c.execute(
            f"""SELECT l.time, l.lat, l.lon, l.source, l.simulated, {dist} AS distance_miles
                FROM lightning_strikes l JOIN sites s ON s.site_id = %(site)s
                WHERE l.time > now() - make_interval(mins => %(minutes)s)
                  AND {_near_box('l.lat', 'l.lon', 's.lat', 's.lon', '%(miles)s')}
                  AND {dist} <= %(miles)s
                ORDER BY distance_miles""", {"site": site_id, "minutes": minutes, "miles": miles}).fetchall()
    return [_clean(r) | {"distance_miles": round(r["distance_miles"], 1)} for r in rows]


def stop_work_status(site_id: str, miles: float = STOP_WORK_MILES, minutes: int = STOP_WORK_MINUTES) -> dict:
    """Matches StopWork in contracts/types.ts. Any strike within 10 mi -> stop work until 30 min after the LAST one."""
    strikes = strikes_near(site_id, miles, minutes)
    if not strikes:
        return {"active": False, "reason": None, "last_strike_at": None, "stop_work_until": None,
                "strikes_last_30_min": 0, "nearest_strike_miles": None}
    last = max(_parse_ts(s["time"]) for s in strikes)
    return {"active": True, "reason": "lightning", "last_strike_at": _iso(last),
            "stop_work_until": _iso(last + timedelta(minutes=minutes)), "strikes_last_30_min": len(strikes),
            "nearest_strike_miles": strikes[0]["distance_miles"],
            "simulated": any(s["simulated"] for s in strikes)}


def site_history(site_id: str, hours: int = 48) -> dict:
    """Hourly chart series (matches SiteHistory). Uses the continuous aggregates on Tiger, raw tables otherwise."""
    if has_view("site_risk_hourly") and has_view("weather_hourly"):
        scores = """SELECT bucket AS b, max_score AS v FROM site_risk_hourly
                    WHERE site_id = %(site)s AND bucket >= %(start)s"""
        weather = """SELECT bucket AS b, max_heat_index_f AS hi, max_precip_in AS rain FROM weather_hourly
                     WHERE site_id = %(site)s AND bucket >= %(start)s"""
    else:
        scores = """SELECT date_trunc('hour', scored_at) AS b, max(hazard_score) AS v FROM site_scores
                    WHERE site_id = %(site)s AND day_offset = 0 AND scored_at >= %(start)s GROUP BY 1"""
        weather = """SELECT date_trunc('hour', time) AS b, max(heat_index_f) AS hi, max(precipitation_in) AS rain
                     FROM weather_obs WHERE site_id = %(site)s AND time >= %(start)s GROUP BY 1"""
    dist = _distance_sql("l.lat", "l.lon", "s.lat", "s.lon")
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    start = now - timedelta(hours=hours - 1)
    with conn() as c:
        rows = c.execute(
            f"""WITH hours AS (SELECT generate_series(%(start)s::timestamptz, %(now)s::timestamptz, INTERVAL '1 hour') AS b),
                     sc AS ({scores}), w AS ({weather}),
                     st AS (SELECT date_trunc('hour', l.time) AS b, count(*) AS n
                            FROM lightning_strikes l JOIN sites s ON s.site_id = %(site)s
                            WHERE l.time >= %(start)s AND {_near_box('l.lat', 'l.lon', 's.lat', 's.lon', '10')}
                              AND {dist} <= 10 GROUP BY 1)
                SELECT hours.b AS time, sc.v AS hazard_score, w.hi AS heat_index_f, w.rain AS rain_in,
                       COALESCE(st.n, 0) AS strikes_within_10mi
                FROM hours LEFT JOIN sc ON sc.b = hours.b LEFT JOIN w ON w.b = hours.b LEFT JOIN st ON st.b = hours.b
                ORDER BY hours.b""", {"site": site_id, "start": start, "now": now}).fetchall()
    series = [{"time": _iso(r["time"]),
               "hazard_score": round(r["hazard_score"], 1) if r["hazard_score"] is not None else None,
               "heat_index_f": round(r["heat_index_f"]) if r["heat_index_f"] is not None else None,
               "rain_in": round(r["rain_in"], 2) if r["rain_in"] is not None else None,
               "soil_moisture_pct": None, "strikes_within_10mi": int(r["strikes_within_10mi"])} for r in rows]
    return {"site_id": site_id, "hours": hours, "bucket": "1h", "series": series}


def risk_trend(site_id: str, days: int = 7) -> list[dict]:
    """Daily max/avg score for the last `days` days."""
    src = ("SELECT time_bucket(INTERVAL '1 day', bucket) AS day, max(max_score) AS max_score, avg(avg_score) AS avg_score "
           "FROM site_risk_hourly WHERE site_id = %s AND bucket > now() - make_interval(days => %s) GROUP BY 1 ORDER BY 1"
           if has_view("site_risk_hourly") else
           "SELECT date_trunc('day', scored_at) AS day, max(hazard_score) AS max_score, avg(hazard_score) AS avg_score "
           "FROM site_scores WHERE site_id = %s AND day_offset = 0 AND scored_at > now() - make_interval(days => %s) "
           "GROUP BY 1 ORDER BY 1")
    with conn() as c:
        rows = c.execute(src, (site_id, days)).fetchall()
    return [{"date": r["day"].date().isoformat(), "max_score": round(r["max_score"], 1),
             "avg_score": round(r["avg_score"], 1)} for r in rows]


def _local_hour(dt: datetime, tz: str) -> str:
    t = dt.astimezone(ZoneInfo(tz))
    return f"{t.hour % 12 or 12} {'AM' if t.hour < 12 else 'PM'}"


def forecast_drift(site_id: str, valid_at: str | datetime | None = None, max_snapshots: int = 8) -> dict | None:
    """How the rain chance for one forecast hour changed across forecast runs (matches ForecastDrift).
    Default hour: the next 24 h hour with the highest rain chance in the latest run."""
    site = _site(site_id)
    if not site:
        return None
    with conn() as c:
        if valid_at is None:
            row = c.execute(
                """SELECT valid_at FROM forecast_hourly
                   WHERE site_id = %s AND issued_at = (SELECT max(issued_at) FROM forecast_hourly WHERE site_id = %s)
                     AND valid_at > now() AND valid_at <= now() + INTERVAL '24 hours'
                     AND precipitation_probability_pct IS NOT NULL
                   ORDER BY precipitation_probability_pct DESC, valid_at LIMIT 1""", (site_id, site_id)).fetchone()
            if not row:
                return None
            valid_at = row["valid_at"]
        valid_at = _parse_ts(valid_at)
        rows = c.execute(
            """SELECT issued_at, precipitation_probability_pct AS value FROM forecast_hourly
               WHERE site_id = %s AND valid_at = %s AND precipitation_probability_pct IS NOT NULL
               ORDER BY issued_at DESC LIMIT %s""", (site_id, valid_at, max_snapshots)).fetchall()[::-1]
    if not rows:
        return None
    snaps = [{"issued_at": _iso(r["issued_at"]), "value": round(r["value"])} for r in rows]
    first, last = snaps[0]["value"], snaps[-1]["value"]
    hour, since = _local_hour(valid_at, site["timezone"]), _local_hour(rows[0]["issued_at"], site["timezone"])
    if len(snaps) == 1:
        summary = f"{hour} rain chance is {last}% (first forecast run)."
    elif last == first:
        summary = f"{hour} rain chance has held at {last}% since {since}."
    else:
        summary = f"{hour} rain chance {'rose' if last > first else 'fell'} from {first}% to {last}% since {since}."
    return {"variable": "rain_probability_pct", "valid_at": _iso(valid_at), "snapshots": snaps, "summary": summary}


def get_briefing(site_id: str, for_date: str | None = None, language: str = "en") -> dict | None:
    """Briefing body (matches Briefing). Latest date if for_date is None."""
    with conn() as c:
        row = c.execute("SELECT body FROM briefings WHERE site_id = %s AND language = %s "
                        + ("AND for_date = %s " if for_date else "") + "ORDER BY for_date DESC LIMIT 1",
                        (site_id, language, for_date) if for_date else (site_id, language)).fetchone()
    return row["body"] if row else None


def get_report(report_id: str) -> dict | None:
    with conn() as c:
        row = c.execute("SELECT * FROM reports WHERE report_id = %s", (report_id,)).fetchone()
    return _clean(row) if row else None


def site_reports(site_id: str, limit: int = 50) -> list[dict]:
    with conn() as c:
        rows = c.execute("SELECT * FROM reports WHERE site_id = %s ORDER BY uploaded_at DESC LIMIT %s",
                         (site_id, limit)).fetchall()
    return [_clean(r) for r in rows]


def open_report_counts() -> dict[str, int]:
    with conn() as c:
        rows = c.execute("SELECT site_id, count(*) AS n FROM reports WHERE status = 'pending_review' GROUP BY 1").fetchall()
    return {r["site_id"]: r["n"] for r in rows}


def stats() -> dict:
    """Row counts and TimescaleDB details (hypertables, chunks, compression) for the README and judges."""
    out = {}
    with conn() as c:
        for t in ("sites", "weather_obs", "forecast_hourly", "site_scores", "lightning_strikes", "briefings", "reports"):
            out[t] = c.execute(f"SELECT count(*) AS n FROM {t}").fetchone()["n"]
        if has_timescale():
            out["hypertables"] = [dict(r) for r in c.execute(
                "SELECT hypertable_name, num_chunks, compression_enabled FROM timescaledb_information.hypertables "
                "ORDER BY hypertable_name").fetchall()]
            out["continuous_aggregates"] = [r["view_name"] for r in c.execute(
                "SELECT view_name FROM timescaledb_information.continuous_aggregates").fetchall()]
            out["policies"] = [f"{r['proc_name']} on {r['hypertable_name']}" for r in c.execute(
                "SELECT proc_name, hypertable_name FROM timescaledb_information.jobs WHERE job_id >= 1000 "
                "ORDER BY hypertable_name, proc_name").fetchall()]
    return out


# ---------- demo helper ----------

def simulate_strike(site_id: str, miles: float = 4.0, bearing_deg: float = 45.0) -> dict:
    """DEMO: add a strike `miles` from a site, flagged simulated=True (for POST /api/demo/strike)."""
    site = _site(site_id)
    if not site:
        raise KeyError(f"Unknown site {site_id}")
    d, b = miles / EARTH_MILES, math.radians(bearing_deg)
    lat1, lon1 = math.radians(site["lat"]), math.radians(site["lon"])
    lat2 = math.asin(math.sin(lat1) * math.cos(d) + math.cos(lat1) * math.sin(d) * math.cos(b))
    lon2 = lon1 + math.atan2(math.sin(b) * math.sin(d) * math.cos(lat1), math.cos(d) - math.sin(lat1) * math.sin(lat2))
    strike = {"time": datetime.now(timezone.utc), "lat": math.degrees(lat2), "lon": math.degrees(lon2),
              "source": "simulated", "simulated": True}
    save_strikes([strike])
    return _clean(strike)


# ---------- loading files into Tiger ----------

def load_live(archive: bool = False) -> None:
    sites_json = json.loads(SITES_FILE.read_text())
    sites = sites_json["sites"] if isinstance(sites_json, dict) else sites_json
    print(f"  sites: {upsert_sites(sites)}")

    if archive:  # replay every archived weather run: real forecast drift + a real score history for today
        files = sorted((LIVE / "archive").glob("weather_*.json"))
        score_sites = None
        try:
            sys.path.insert(0, str(BACKEND / "ml" / "src"))
            from cypress_ml.score import score_sites
        except Exception as e:  # noqa: BLE001
            print(f"  (scoring unavailable for archive replay: {e})")
        for f in files:
            snap = json.loads(f.read_text())
            n = save_weather(snap)
            msg = f"  archive {f.name}: {n['weather_obs']} obs, {n['forecast_hourly']} forecast rows"
            if score_sites and snap.get("sites") and snap["sites"][0].get("daily"):
                msg += f", {save_scores(score_sites(snap, sites, days=(0, 1)), scored_at=snap['fetched_at'])} scores"
            print(msg)

    weather_file, scores_file = LIVE / "weather_latest.json", LIVE / "scores_latest.json"
    if weather_file.exists():
        n = save_weather(json.loads(weather_file.read_text()))
        print(f"  latest weather: {n['weather_obs']} obs, {n['forecast_hourly']} forecast rows")
    if scores_file.exists():
        print(f"  latest scores: {save_scores(json.loads(scores_file.read_text())['scores'])}")
    briefings = sorted((LIVE / "briefings").glob("*.json"))
    print(f"  briefings: {sum(save_briefing(json.loads(f.read_text())) for f in briefings)} rows from {len(briefings)} files")


def _check() -> None:
    sites = ranked_sites()
    print("Top 5 sites right now:")
    for s in sites[:5]:
        print(f"  #{s['rank']} {s['hazard_score']} {s['risk_level']:8s} {s['name'][:30]:30s} scored {s['scored_at']}")
    if not sites or sites[0]["hazard_score"] is None:
        print("No scores yet. Run: load")
        return
    top = sites[0]["site_id"]
    hist = site_history(top, 12)
    filled = [p for p in hist["series"] if p["hazard_score"] is not None or p["heat_index_f"] is not None]
    print(f"\nHistory for {sites[0]['name']} (last 12 h): {len(filled)}/{len(hist['series'])} hours with data")
    for p in filled[-4:]:
        print(f"  {p['time']}  score {p['hazard_score']}  heat index {p['heat_index_f']}  rain {p['rain_in']}  "
              f"strikes {p['strikes_within_10mi']}")
    drift = forecast_drift(top)
    print(f"\nForecast drift: {drift['summary'] if drift else 'needs 2+ forecast runs (load --archive)'}")
    print(f"Stop-work status: {stop_work_status(top)}")
    print(f"Briefing (en) stored: {'yes' if get_briefing(top) else 'no'}")
    print(f"\nTiger Data: {json.dumps(stats(), indent=1, default=str)}")


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("setup")
    ld = sub.add_parser("load")
    ld.add_argument("--archive", action="store_true", help="also replay archived weather runs")
    sub.add_parser("check")
    st = sub.add_parser("strike")
    st.add_argument("site_id")
    st.add_argument("--miles", type=float, default=4.0)
    args = ap.parse_args()

    if args.cmd == "setup":
        print("Setting up Tiger Data schema")
        setup_schema()
    elif args.cmd == "load":
        print("Loading data into Tiger Data")
        load_live(args.archive)
    elif args.cmd == "check":
        _check()
    elif args.cmd == "strike":
        s = simulate_strike(args.site_id, args.miles)
        print(f"Simulated strike at {s['lat']:.4f}, {s['lon']:.4f} ({args.miles} mi away)")
        print(f"Stop-work: {stop_work_status(args.site_id)}")


if __name__ == "__main__":
    main()