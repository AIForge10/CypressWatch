# API contract (owner: M4)

The single source of truth between the frontends and the backend. Agree on an endpoint
here **before** building both sides, so M1/M2 can mock it while M3/M4 implement it.
Response shapes are typed in [`contracts/types.ts`](../contracts/types.ts), with sample JSON in
[`contracts/mocks/`](../contracts/mocks); conventions (UTC `Z` timestamps, units in field names,
hazard keys, the lightning rule) are in [`contracts/README.md`](../contracts/README.md).

Live, auto-generated docs while the API runs: `http://localhost:<port>/docs`
(run `uvicorn app.main:app --reload --port 8010` from `backend/api`).

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
The **Auth** column below shows what each endpoint enforces today (see Known gaps).

## Routers

| Router file | Prefix | Owner | Endpoints |
|---|---|---|---|
| `sites.py` | `/api/sites` | M4 | `GET /api/sites`, `GET /api/sites/summary`, `GET /api/sites/{site_id}`, `GET /api/sites/{site_id}/history` |
| `scores.py` | `/api` | M3 | `GET /api/health`, `GET /api/me`, `GET /api/model`, `GET /api/scores`, `GET /api/sites/{site_id}/insights`, `GET /api/tiger` |
| `alerts.py` | `/api/alerts` | M4 | `GET /api/alerts`, `POST /api/alerts/{alert_id}/acknowledge`, `POST /api/alerts/{alert_id}/override` |
| `simulate.py` | `/api/demo` | M4 | `POST /api/demo/strike` (DemoStrikeRequest), `POST /api/demo/flood-rain` (DemoHeavyRainRequest) |
| `reports.py` | `/api` | M3 (backend), M2/M1 (screens) | `POST /api/reports`, `GET /api/reports`, `GET /api/reports/{report_id}`, `GET /api/reports/{report_id}/photo`, `PATCH /api/reports/{report_id}`, `GET /api/sites/{site_id}/reports` |
| `briefings.py` | `/api` | M3 | `GET /api/sites/{site_id}/briefing` |
| `ledger.py` | `/api/ledger` | M3 | `GET /api/ledger/verify/{record_id}`, `GET /api/ledger/records` |
| `realtime.py` | `/api/ws` | M2 (wired by M4) | WebSocket live events (below) |

## Endpoints

Auth: **any** = any signed-in role, filtered to the token's `site_ids`; **site** = 403 unless the site is assigned;
roles listed = only those roles; **open** = no token checked yet.

| Method | Path | Auth | Request | Response (mock / type) | Used by |
|---|---|---|---|---|---|
| GET | `/api/health` | public | | `{"ok": true}` | Everyone |
| GET | `/api/me` | any | | `me.json` / `Me`; a `"*"` site claim is expanded to every site, role `owner` is returned as `project_owner` | M1, M2 |
| GET | `/api/sites` | open | | `sites.json` / `SitesResponse`, ranked by hazard score | M1 (map, ranked list) |
| GET | `/api/sites/summary` | any | | `{server_time, sites[]}`: compact per-site status for the dashboard (see above) | M1 |
| GET | `/api/sites/{site_id}` | open | | `site_detail.json` / `SiteDetail` (score, factors, explanation, conditions, drift, days like today, storm approach) | M1, M2 |
| GET | `/api/sites/{site_id}/history` | open | `?hours=48` | `site_history.json` / `SiteHistory`, hourly buckets | M1 (charts) |
| GET | `/api/sites/{site_id}/insights` | open | | forecast drift + days like today + storm approach + stop-work + 7-day trend | M1 |
| GET | `/api/scores` | open | `?day_offset=0\|1` (today / tomorrow) | latest score for every site, ranked | M1 |
| GET | `/api/model` | open | | `model_card.json` / `ModelCard` | M1 (AI/ML spotlight) |
| GET | `/api/tiger` | open | | live Tiger Data stats: hypertables, compression, aggregates, jobs | M1 (Tiger panel) |
| GET | `/api/alerts` | any | `?status=active&site_id=` | `alerts.json` / `AlertsResponse` | M1, M2 |
| POST | `/api/alerts/{alert_id}/acknowledge` | crew, supervisor | | `ack_response.json` | M2 |
| POST | `/api/alerts/{alert_id}/override` | supervisor + signed `mfa_at` ≤ 5 min (else `401 step_up_required`) | `override_request.json` | `override_response.json` | M1 |
| POST | `/api/demo/strike` | supervisor | `demo_strike_request.json` | strike queued; engine emits `stop_work_started` with `simulated: true` | M1 (demo button) |
| POST | `/api/demo/flood-rain` | supervisor | `{site_id, overnight_in}` | `{flood_alert_expected, river_sites[]}`; flood rule raises `flood_risk` on its next tick, `simulated: true` | M1 (demo button) |
| GET | `/api/sites/{site_id}/briefing` | open | `?date=YYYY-MM-DD&lang=en\|es` (no date = latest) | `briefing.json` / `Briefing` | M1, M2 |
| POST | `/api/reports` | open (crew app has no Auth0 token yet) | multipart: `photo` (JPEG/PNG, ≤ 15 MB) + `data` = `report_request.json` | `201` `report_created.json` / `Report` with Gemini `triage`. Same `client_id` again → `409 duplicate` + the existing report | M2 |
| GET | `/api/reports` | supervisor, owner | `?status=pending_review\|confirmed\|dismissed\|all&limit=100` | `{server_time, status, reports[]}`: review queue across the caller's sites | M1 |
| GET | `/api/reports/{report_id}` | site | | `Report` | M1, M2 |
| GET | `/api/reports/{report_id}/photo` | site | | JPEG, resized to ≤ 1280 px, EXIF/GPS removed (fetch with the token, show as a blob URL) | M1, M2 |
| PATCH | `/api/reports/{report_id}` | supervisor + site | `report_confirm_request.json`: `{status: "confirmed"\|"dismissed", confirmed_hazard?, confirmed_severity?}` | updated `Report` with `ledger_record_id`; the decision and who made it are anchored to Solana devnet | M1 (supervisor confirms) |
| GET | `/api/sites/{site_id}/reports` | site | `?limit=50` | `reports.json` / `ReportsResponse` | M1, M2 |
| GET | `/api/ledger/verify/{record_id}` | supervisor, owner + site | | `ledger_verify.json` (match) / `ledger_verify_tampered.json` | M1 (Verify page) |
| GET | `/api/ledger/records` | supervisor, owner | | recent ledger records for the caller's sites | M1 (ledger list) |

### Errors

`{"error": "not_found", "message": "...", "request_id": "req_..."}` (`error.json`). Codes:
`400 bad_request`, `401 unauthorized | step_up_required`, `403 forbidden`, `404 not_found`,
`409 duplicate`, `413 too_large`, `422 invalid_request`, `503 source_unavailable | auth_unavailable`.

## Realtime events (DeepSpace, M2)

Connect to `ws://<host>/api/ws` and send `{"access_token": "<Auth0 token>"}` as the first message. On connect: `{"server_time", "events": [last 20]}`; afterwards each
event arrives as `{"server_time", "event": {...}}`. Envelope (`live_events.json`):
`{event_id, type, site_id, occurred_at, simulated, data}`.

| Event | Payload (`data`) | Sent by |
|---|---|---|
| `stop_work_started` | `alert_id, strike_at, distance_miles, stop_work_until` | Lightning engine (`workers/engines/lightning.py`) |
| `stop_work_extended` | `alert_id, strike_at, distance_miles, stop_work_until` | Lightning engine |
| `all_clear` | `alert_id, reason` | Lightning engine (30 min after the last strike, or an MFA override) |
| `alert_acknowledged` | `alert_id, user_id, name` | Lightning engine (after `POST /acknowledge`) |
| `report_created` | `report_id, hazard, severity, status` | `POST /api/reports` |
| `report_confirmed` | `report_id, confirmed_hazard, confirmed_severity` | `PATCH /api/reports/{id}` |
| `score_updated` | `hazard_score, risk_level, previous_score` | Scheduler (`workers/scheduler/store.py`) |
| `briefing_ready` | `briefing_id, for_date` | Scheduler, 6 PM site-local time |
| `flood_alert_started` | `alert_id, reasons, evidence_sources` | Flood rule (`workers/engines/flood.py`) |
| `flood_alert_cleared` | `alert_id, reason` | Flood rule |

Stop-work, all-clear, acknowledgment and `report_created` events are also written to the Solana Safety
Ledger by the scheduler (`workers/scheduler/anchor.py`); supervisor report decisions are written by
`PATCH /api/reports/{id}`.

## Known gaps

- Endpoints marked **open** above do not check the token yet. `POST /api/reports` stays open until the
  crew app (DeepSpace sign-in) has an agreed token bridge to this API.
- Errors raised through FastAPI's `HTTPException` (auth, alerts, simulate, ledger) come back wrapped as
  `{"detail": {...}}` instead of the plain error shape.
