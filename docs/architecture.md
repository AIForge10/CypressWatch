# Architecture

See the diagram in `docs/plan.pdf` (page 12). Data flows top to bottom:

1. **Vultr workers** (`backend/workers`) poll Open-Meteo, NWS, GOES GLM, USGS, NASA FIRMS → **Tiger Data** (`backend/db`).
2. **Alert engine** (`backend/workers/cypress_workers/engines`) is the *only* path that can start or end a stop-work.
3. **ML service** (`backend/ml`) produces the 0–10 hazard index; **Gemini** (`backend/ai`) writes briefings, triages photos, explains scores.
4. **Solana Safety Ledger** (`backend/ledger`) anchors hourly per-site Merkle roots on devnet.
5. **API** (`backend/api`) serves the **supervisor dashboard** (`frontend/supervisor`), guarded by Auth0. The separate **crew phone app** (`frontend/crew-deepspace`) uses DeepSpace sign-in and live sync. Its demo mode is not yet the same live backend data source; backend integration requires an agreed auth bridge.
6. Optional **Site Beacon** (`hardware/site-beacon`).
