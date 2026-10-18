# Workers (M4)

Ingestion pollers, the deterministic alert engines, and the 6 PM scheduler. Runs on Vultr.

- `cypress_workers/ingest/`: one module per source (Open-Meteo, GLM lightning, USGS gage height, NWS flood alerts)
- `cypress_workers/engines/`: lightning 10-mile countdown, overnight flood rule
- `cypress_workers/scheduler/`: 6 PM local-time trigger per site time zone

## Running live (three separate processes)

```bash
# 1. Live GLM ingest (GOES-19 GLM-L2-LCFA; refreshes lightning_latest.json every pass)
python -m cypress_workers.ingest.lightning_glm --loop 60   # poll every 60 s; omit --loop for one shot

# 2. The alert engine: only writer of stop_work.json + the alert/ack/override event stream.
#    (--loop 5 = tick every 5 s; it also polls GLM itself every --glm-poll seconds and runs
#     the flood rule every --flood-poll seconds, which polls USGS gauges + NWS alerts itself.)
python -m cypress_workers.engines.lightning --loop 5 --glm-poll 60 --flood-poll 60 --satellite 19

#    Flood engine standalone (same rule, without the lightning loop; useful for tests):
python -m cypress_workers.engines.flood --once

# 3. Scheduler: 15-min weather -> score -> explain -> save chain, hourly ledger anchor, 6 PM briefings
python -m cypress_workers.scheduler.scheduler
```

## Flood rule (engines/flood.py)

River sites get a `flood_risk` alert (severity `warning`, never a stop-work) when any trigger fires:

1. **Heavy-rain night**: overnight rainfall (the last two local-day precipitation sums from
   `weather_latest.json`) >= 3.0 in on a *river-relevant* site (sites.json `river_site`, a non-X
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

