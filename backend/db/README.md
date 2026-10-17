# Database: Tiger Data / TimescaleDB (M4)

- `migrations/`: plain SQL, applied in filename order. **Name files with a UTC timestamp**
  (`20261017T0130_create_conditions.sql`) so two people never create the same number.
  Never edit a migration that has been merged; add a new one.
- `seeds/`: seed data (e.g. the 50+ Florida sites from EIA-860M).

Hypertables planned: `conditions`, `forecasts`, `lightning_flashes`, `hazard_scores`,
`crew_reports`, `alerts`.
