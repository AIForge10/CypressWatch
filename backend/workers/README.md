# Workers (M4)

Ingestion pollers, the deterministic alert engines, and the 6 PM scheduler. Runs on Vultr.

- `cypress_workers/ingest/`: one module per source (Open-Meteo, GLM lightning, USGS, NWS, FIRMS)
- `cypress_workers/engines/`: lightning 10-mile countdown, overnight flood rule
- `cypress_workers/scheduler/`: 6 PM local-time trigger per site time zone
