# API contract (owner: M4)

The single source of truth between the frontends and the backend. Agree on an endpoint
here **before** building both sides, so M1/M2 can mock it while M3/M4 implement it.
Mirror request/response types in `frontend/packages/shared/src`.

Live, auto-generated docs while the API runs: http://localhost:8000/docs

`GET /api/sites/summary` combines the site inventory with today's hazard score
and active alerts. `data_freshness` describes the score age, and
`weather_fetched_at` gives the Open-Meteo snapshot time used for the score.
`stop_work` contains only active lightning stop-work alerts, including
`last_strike_at` and `simulated`; `flood_warning` is a separate warning and
never carries a stop-work countdown. The response includes only sites in the
validated access token's `site_ids` claim.

## Auth

Every `/api/*` endpoint requires `Authorization: Bearer <Auth0 access token>`; `/health` remains public.
The API validates the token signature against the tenant JWKS, issuer, audience, expiry, role,
and assigned site ids. The browser never supplies trusted identity or MFA headers. See
[`auth0-api.md`](auth0-api.md) for the environment values and required Post-Login Action claims.

| Router file | Prefix | Owner | Endpoints (fill in) |
|---|---|---|---|
| `sites.py` | `/sites` | M4 | |
| `scores.py` | `/scores` | M3 | |
| `alerts.py` | `/alerts` | M4 | |
| `simulate.py` | `/simulate` | M4 | `POST /api/demo/strike` (DemoStrikeRequest), `POST /api/demo/flood-rain` (DemoHeavyRainRequest) |
| `reports.py` | `/reports` | M2 | |
| `briefings.py` | `/briefings` | M3 | |
| `ledger.py` | `/ledger` | M3 | |

## Realtime events (DeepSpace, M2)

| Event | Payload | Sent by |
|---|---|---|
| `flood_alert_started` | {alert_id, reasons, evidence_sources} | flood rule (engines/flood.py) |
| `flood_alert_cleared` | {alert_id, reason} | flood rule (engines/flood.py) |
