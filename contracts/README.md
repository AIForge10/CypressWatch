# CypressWatch API contract (v0.1)

This folder is the shared agreement between frontend (M1, M2), backend (M4), and AI/ML (M3).
Frontend builds against the files in `mocks/` now; backend returns exactly these shapes later.
**If you need to change a shape, change it here first and tell the team.**

## How to use it

- **Frontend (M1, M2):** copy `contracts/` into `web/src/contracts/`. Call the functions in `api.ts` (e.g. `api.sites()`, `api.site("site_012")`) instead of `fetch`. In `web/.env` set `VITE_USE_MOCKS=true` to use the sample JSON; when the backend is ready, set it to `false` and set `VITE_API_URL`. No component code changes. `secondsLeft()` in `api.ts` computes the lightning countdown offline.
- **Backend (M4):** each endpoint below must return the matching mock file's shape. Pydantic models should mirror `types.ts`.
- **AI/ML (M3):** your service fills `hazard_score`, `top_factors`, `explanation`, the briefing, and photo triage. Shapes are in `site_detail.json`, `briefing.json`, and `report_created.json`.

## Conventions (everyone follows these)

| Rule | Example |
| --- | --- |
| Timestamps are ISO 8601 in **UTC** with `Z` | `"2026-10-17T18:42:10Z"` |
| Each site carries its own IANA time zone for display and the 6 PM briefing | `"timezone": "America/New_York"` |
| Units go in the field name | `heat_index_f`, `wind_gust_mph`, `rain_24h_in`, `distance_miles` |
| IDs are strings with a prefix | `site_012`, `alt_7f3a`, `rpt_91c2`, `brf_…`, `rec_…` |
| Hazard score is 0–10, one decimal | `8.2` |
| Risk level comes from the score | `low` < 4, `moderate` 4–5.9, `high` 6–7.9, `extreme` ≥ 8 |
| Every live value says where and when it came from | `"source": "open-meteo"`, `"observed_at": "…"` |
| Field names are `snake_case` | `stop_work_until` |
| Missing data is `null`, never `0` or `""` | `"soil_moisture_pct": null` |
| Simulated demo data is always flagged | `"simulated": true` |

### Hazard keys (use exactly these)

`lightning`, `heat`, `storm`, `flood`, `soil_saturation`, `wildfire`, `wildlife`

### Lightning rule (Sperry requirement)

- Any strike within **10 miles** of a site starts a stop-work alert.
- The all-clear time is **30 minutes after the most recent strike**: `stop_work_until = last_strike_at + 30 min`.
- Each new strike within 10 miles moves `stop_work_until` forward (the countdown restarts).
- **Clients compute the countdown locally** from `stop_work_until`, so it keeps running offline. Use `server_time` from any response to correct the device clock.

### Flood rule (Sperry requirement)

River sites get a `flood_risk` alert (severity `warning`; `stop_work_until` stays `null` — floods warn, lightning stops work) when any of these fire:

- **Heavy-rain night:** overnight rainfall ≥ 3.0 in on a river-relevant site (river-site flag, non-X FEMA zone, or within 15 mi of a USGS gauge).
- **NWS:** an active NWS flood alert lists the site's county.
- **Gauge rise:** a nearby USGS gauge rose ≥ 2.0 ft in its 3 h ingest window.

The alert clears ~6 h after the last trigger, or earlier by supervisor override. `Alert.data.reasons` has the plain-language "why", and `Alert.expires_at` is when it would auto-clear.

## Endpoints

All require `Authorization: Bearer <Auth0 access token>` except `/api/health`.

| Method | Path | Returns (mock file) | Who uses it |
| --- | --- | --- | --- |
| GET | `/api/health` | `{ "ok": true }` | Everyone |
| GET | `/api/me` | `me.json` | M1, M2 |
| GET | `/api/sites` | `sites.json` — all sites, ranked by score | M1 (map, ranked list) |
| GET | `/api/sites/{site_id}` | `site_detail.json` | M1 (site page), M2 (crew view) |
| GET | `/api/sites/{site_id}/history?hours=48` | `site_history.json` — chart series | M1 (charts) |
| GET | `/api/alerts?status=active` | `alerts.json` | M1, M2 |
| POST | `/api/alerts/{alert_id}/acknowledge` | `ack_response.json` | M2 |
| POST | `/api/alerts/{alert_id}/override` | `override_request.json` → `override_response.json`. Needs step-up MFA (`401` with `"error": "step_up_required"` until done) | M1 |
| GET | `/api/sites/{site_id}/briefing?date=YYYY-MM-DD` | `briefing.json` | M1, M2 |
| POST | `/api/reports` | multipart: `photo` file + `data` = `report_request.json` → `report_created.json` | M2 |
| GET | `/api/sites/{site_id}/reports` | `reports.json` | M1, M2 |
| PATCH | `/api/reports/{report_id}` | `report_confirm_request.json` → updated report | M1 (supervisor confirms) |
| GET | `/api/ledger/verify/{record_id}` | `ledger_verify.json` (match) / `ledger_verify_tampered.json` | M1 (Verify page) |
| GET | `/api/model` | `model_card.json` | M1 (AI/ML spotlight) |
| POST | `/api/demo/strike` | `demo_strike_request.json` → `live_events.json` first event. **Demo only, flagged simulated** | M1 (demo button) |
| POST | `/api/demo/flood-rain` | `demo_heavy_rain.json` → the flood rule raises a `flood_risk` alert on river sites within one flood tick (~<2 min). **Demo only, flagged simulated** | M1 (demo button) |

## Live events (DeepSpace real-time sync)

Pushed to every subscribed device; see `live_events.json`. Every event has the same envelope:

```json
{ "event_id": "evt_…", "type": "…", "site_id": "site_012", "occurred_at": "…", "data": { … } }
```

Types: `stop_work_started`, `stop_work_extended`, `all_clear`, `alert_acknowledged`, `flood_alert_started`, `flood_alert_cleared`, `report_created`, `report_confirmed`, `score_updated`, `briefing_ready`. The flood pair carries `{alert_id, reasons, evidence_sources}` and `{alert_id, reason}` in `data`.

## Offline queue (crew app)

When a crew phone has no signal, M2 stores actions in IndexedDB as `offline_queue_item.json` and replays them in order when signal returns. Each item has a `client_id` so the backend can ignore duplicates.

## Errors

Every error uses one shape (`error.json`):

```json
{ "error": "not_found", "message": "Site site_999 does not exist.", "request_id": "req_…" }
```

| HTTP | `error` |
| --- | --- |
| 400 | `bad_request` |
| 401 | `unauthorized`, `step_up_required` |
| 403 | `forbidden` (role or site not assigned) |
| 404 | `not_found` |
| 409 | `duplicate` (offline replay already applied) |
| 503 | `source_unavailable` (an upstream data source is down; data shown may be stale) |

## Note on sample data

Mock values (site names, coordinates, scores) are placeholders for building the UI. M4 replaces them with the real EIA-860M plants and live data.

`sites.json` holds 52 sample sites across Florida, placed at town centres, already sorted by rank: 1 extreme, 9 high, 21 moderate, 21 low. Only `site_012` has an active lightning stop-work. Four Panhandle sites use `America/Chicago`, so the frontend can test that the 6 PM briefing and local times follow each site's own time zone. `site_detail.json` is always `site_012`, whichever site is clicked, until the backend is live.
