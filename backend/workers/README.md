# Workers (M4)

Ingestion pollers, the deterministic alert engines, and the 6 PM scheduler. Runs on Vultr.

- `cypress_workers/ingest/`: one module per source (Open-Meteo, GLM lightning, USGS, NWS, FIRMS)
- `cypress_workers/engines/`: lightning 10-mile countdown, overnight flood rule
- `cypress_workers/scheduler/`: 6 PM local-time trigger per site time zone

## Running live (three separate processes)

```bash
# 1. Live GLM ingest (GOES-19 GLM-L2-LCFA; refreshes lightning_latest.json every pass)
python -m cypress_workers.ingest.lightning_glm --loop 60   # poll every 60 s; omit --loop for one shot

# 2. The engine: only writer of stop_work.json + the alert/ack/override event stream.
#    (--loop 5 = tick every 5 s; it also polls GLM itself every --glm-poll seconds.)
python -m cypress_workers.engines.lightning --loop 5 --glm-poll 60 --satellite 19

# 3. Scheduler: 15-min weather -> score -> explain -> save chain, hourly ledger anchor, 6 PM briefings
python -m cypress_workers.scheduler.scheduler
```

All state under `data/` (`live/` for the current snapshot + `history/` for the download cache).
`data/live/events.json` is the append-only contract log the API tails at `GET /api/ws`; the API
queues demo strikes (`strikes_queue.json`) and ack/override actions (`alert_actions.json`) that the
engine drains.

Anchor notes: real-time GLM is `GLM-L2-LCFA` on the NOAA S3 bucket, current GOES-East is **GOES-19**
(GOES-16 LCFA stopped 2025/097); the engine pins it with `--satellite`, polling `--glm-poll` seconds.

