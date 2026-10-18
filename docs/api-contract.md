# API contract (owner: M4)

The single source of truth between the frontends and the backend. Agree on an endpoint
here **before** building both sides, so M1/M2 can mock it while M3/M4 implement it.
Response shapes are typed in [`contracts/types.ts`](../contracts/types.ts), with sample JSON in
[`contracts/mocks/`](../contracts/mocks); conventions (UTC `Z` timestamps, units in field names,
hazard keys, the lightning rule) are in [`contracts/README.md`](../contracts/README.md).

Live, auto-generated docs while the API runs: `http://localhost:<port>/docs`
(run `uvicorn app.main:app --reload --port 8010` from `backend/api`).

## Routers

| Router file | Prefix | Owner | Endpoints |
|---|---|---|---|
| `sites.py` | `/api/sites` | M4 | `GET /api/sites`, `GET /api/sites/summary`, `GET /api/sites/{site_id}`, `GET /api/sites/{site_id}/history` |
| `scores.py` | `/api` | M3 | `GET /api/health`, `GET /api/me`, `GET /api/model`, `GET /api/scores`, `GET /api/sites/{site_id}/insights`, `GET /api/tiger` |
| `alerts.py` | `/api/alerts` | M4 | `GET /api/alerts`, `POST /api/alerts/{alert_id}/acknowledge`, `POST /api/alerts/{alert_id}/override` |
| `simulate.py` | `/api/demo` | M4 | `POST /api/demo/strike` |
| `reports.py` | `/api` | M3 (backend), M2/M1 (screens) | `POST /api/reports`, `GET /api/reports`, `GET /api/reports/{report_id}`, `GET /api/reports/{report_id}/photo`, `PATCH /api/reports/{report_id}`, `GET /api/sites/{site_id}/reports` |
| `briefings.py` | `/api` | M3 | `GET /api/sites/{site_id}/briefing` |
| `ledger.py` | `/api/ledger` | M3 | `GET /api/ledger/verify/{record_id}`, `GET /api/ledger/records` |
| `realtime.py` | `/api/ws` | M2 (wired by M4) | WebSocket live events (below) |

## Endpoints

| Method | Path | Request | Response (mock / type) | Used by |
|---|---|---|---|---|
| GET | `/api/health` | | `{"ok": true}` | Everyone |
| GET | `/api/me` | `Authorization: Bearer <Auth0 token>`; demo mode: optional `X-Demo-Role: crew \| supervisor \| project_owner` | `me.json` / `Me` | M1, M2 |
| GET | `/api/sites` | | `sites.json` / `SitesResponse`, ranked by hazard score | M1 (map, ranked list) |
| GET | `/api/sites/summary` | | `{server_time, sites[]}`: compact per-site status for the dashboard | M1 |
| GET | `/api/sites/{site_id}` | | `site_detail.json` / `SiteDetail` (score, factors, explanation, conditions, drift, days like today, storm approach) | M1, M2 |
| GET | `/api/sites/{site_id}/history` | `?hours=48` | `site_history.json` / `SiteHistory`, hourly buckets | M1 (charts) |
| GET | `/api/sites/{site_id}/insights` | | forecast drift + days like today + storm approach + stop-work + 7-day trend | M1 |
| GET | `/api/scores` | `?day_offset=0\|1` (today / tomorrow) | latest score for every site, ranked | M1 |
| GET | `/api/model` | | `model_card.json` / `ModelCard` | M1 (AI/ML spotlight) |
| GET | `/api/tiger` | | live Tiger Data stats: hypertables, compression, aggregates, jobs | M1 (Tiger panel) |
| GET | `/api/alerts` | `?status=active&site_id=` | `alerts.json` / `AlertsResponse` | M1, M2 |
| POST | `/api/alerts/{alert_id}/acknowledge` | headers `X-User-Id`, `X-User-Name` | `ack_response.json` | M2 |
| POST | `/api/alerts/{alert_id}/override` | `override_request.json`; header `X-MFA-Verified: true` (else `401 step_up_required`) | `override_response.json` | M1 |
| POST | `/api/demo/strike` | `demo_strike_request.json` | strike queued; engine emits `stop_work_started` with `simulated: true` | M1 (demo button) |
| GET | `/api/sites/{site_id}/briefing` | `?date=YYYY-MM-DD&lang=en\|es` (no date = latest) | `briefing.json` / `Briefing` | M1, M2 |
| POST | `/api/reports` | multipart: `photo` (JPEG/PNG, ≤ 15 MB) + `data` = `report_request.json` | `201` `report_created.json` / `Report` with Gemini `triage`. Same `client_id` again → `409 duplicate` + the existing report | M2 |
| GET | `/api/reports` | `?status=pending_review\|confirmed\|dismissed\|all&limit=100` | `{server_time, status, reports[]}`: supervisor queue across all sites | M1 |
| GET | `/api/reports/{report_id}` | | `Report` | M1, M2 |
| GET | `/api/reports/{report_id}/photo` | | JPEG, resized to ≤ 1280 px, EXIF/GPS removed | M1, M2 |
| PATCH | `/api/reports/{report_id}` | `report_confirm_request.json`: `{status: "confirmed"\|"dismissed", confirmed_hazard?, confirmed_severity?}` | updated `Report` with `ledger_record_id`; the decision is anchored to Solana devnet | M1 (supervisor confirms) |
| GET | `/api/sites/{site_id}/reports` | `?limit=50` | `reports.json` / `ReportsResponse` | M1, M2 |
| GET | `/api/ledger/verify/{record_id}` | | `ledger_verify.json` (match) / `ledger_verify_tampered.json` | M1 (Verify page) |
| GET | `/api/ledger/records` | | recent ledger records | M1 (ledger list) |

### Auth

`GET /api/me` verifies the Auth0 access token (RS256, audience `AUTH0_AUDIENCE`, issuer
`https://<AUTH0_DOMAIN>/`) and reads the claims `https://cypresswatch.app/role` and
`https://cypresswatch.app/site_ids`. The Auth0 Action must put these on the **access token**.
Supervisors and project owners with no `site_ids` claim see every site; crew see only their listed sites.
With `AUTH0_DOMAIN` empty in `backend/api/.env`, the API runs in demo mode and returns a demo user.

### Errors

`{"error": "not_found", "message": "...", "request_id": "req_..."}` (`error.json`). Codes:
`400 bad_request`, `401 unauthorized | step_up_required`, `403 forbidden`, `404 not_found`,
`409 duplicate`, `413 too_large`, `422 invalid_request`, `503 source_unavailable`.

## Realtime events (DeepSpace, M2)

Connect to `ws://<host>/api/ws`. On connect: `{"server_time", "events": [last 20]}`; afterwards each
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

Stop-work, all-clear, acknowledgment and `report_created` events are also written to the Solana Safety
Ledger by the scheduler (`workers/scheduler/anchor.py`); supervisor report decisions are written by
`PATCH /api/reports/{id}`.

## Known gaps

- Only `GET /api/me` checks the Auth0 token so far; other endpoints do not enforce roles or `site_ids` yet.
- `alerts.py` and `simulate.py` take the user from `X-User-*` headers until Auth0 is wired, and their
  errors come back wrapped as `{"detail": {...}}` instead of the plain error shape.
