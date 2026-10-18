# Workers

Ingestion pollers, the deterministic alert engines, and the 6 PM scheduler. Runs on Vultr.

- `cypress_workers/ingest/`: one module per source (Open-Meteo, GLM lightning, USGS gage height, NWS flood alerts)
- `cypress_workers/engines/`: lightning 10-mile countdown, overnight flood rule
- `cypress_workers/scheduler/`: 6 PM local-time trigger per site time zone

## Running live (two separate processes)

Use the Python environment from `backend/README.md`. Run each command from
`backend/workers`. The alert engine polls NOAA GOES-19 lightning, USGS gauges,
and NWS flood alerts itself; the scheduler refreshes Open-Meteo weather and
hazard scores every 15 minutes. Live snapshots are written under the existing
ignored `data/live/` directory.

```bash
# Terminal 1: alerts and all hazard-source pollers.
python -m cypress_workers.engines.lightning --loop 5 --glm-poll 60 --flood-poll 60 --gauge-poll 900 --nws-poll 300 --satellite 19

# Terminal 2: Open-Meteo weather and hazard scores, without optional ledger writes.
python -m cypress_workers.scheduler.scheduler --weather-only
```

For a deployment with ledger anchoring and 6 PM briefings configured, use the
full scheduler instead of `--weather-only`:

```bash
python -m cypress_workers.scheduler.scheduler
```

For one-shot source checks, run these from `backend/workers`:

```bash
python -m cypress_workers.ingest.weather_live --past-days 30 --forecast-days 3
python -m cypress_workers.ingest.lightning_glm --satellite 19
python -m cypress_workers.ingest.river_gauges
python -m cypress_workers.ingest.nws_alerts
```

Do not run separate continuous source pollers alongside the alert engine; it
already polls those sources.

## Flood rule (engines/flood.py)

River sites get a `flood_risk` alert (severity `warning`, never a stop-work) when any trigger fires:

1. **Heavy-rain night**: hourly rain from 6 PM yesterday to 6 AM today (or the
   current observed hour, if earlier) in `weather_latest.json` >= 3.0 in on a
   *river-relevant* site (sites.json `river_site`, a non-X
   FEMA `flood_zone`, or within 15 mi of a USGS stage gauge; gauge coordinates are permanent, so
   relevance survives an outage while the live stage/rise numbers do not).
2. **NWS**: an active flood alert in `flood_alerts.json` listing the site's county (ingest polls
   `api.weather.gov` for FL every 5 min).
3. **Gauge rise**: a nearby USGS gauge whose stage rose >= 2.0 ft in the 3 h ingest window.

Alerts stay active while triggers persist (`expires_at` refreshes) and clear to `cleared` ~6 h
after the last trigger. Demo control: `POST /api/demo/flood-rain` (see `routers/simulate.py`)
injects a clearly-labeled simulated heavy-rain night; it fires in the next flood tick and the
engine holds it (survives restart) for 6 h.

All state under `data/` (`live/` for the current snapshot + `history/` for the download cache).
`data/live/events.json` is the append-only contract log the API tails at `GET /api/ws`; the API
queues demo strikes (`strikes_queue.json`), demo heavy rain (`flood_queue.json`) and ack/override
actions (`alert_actions.json`) that the engines drain.

Anchor notes: real-time GLM is `GLM-L2-LCFA` on the NOAA S3 bucket, current GOES-East is **GOES-19**
(GOES-16 LCFA stopped 2025/097); the engine pins it with `--satellite`, polling `--glm-poll` seconds.

