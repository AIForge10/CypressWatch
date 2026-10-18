# CypressWatch

> CypressWatch turns scattered weather, lightning, flood, fire, and wildlife data into one risk
> score per job site, stops work the moment lightning gets close, and keeps a tamper-proof safety
> record every company on the project can verify.

Built for **Sperry Tech PlanIT Control** at SwampHacks XII.

## Live demo

| | Link |
|---|---|
| **Supervisor dashboard** (Auth0 sign-in) | https://64-177-55-82.sslip.io |
| **Crew app** (phone, Google sign-in via DeepSpace) | https://cypresswatch-crew.app.space |
| **API docs** | https://64-177-55-82.sslip.io/docs |
| **Judge login** (dashboard) | see the Devpost submission |
| **Solana Safety Ledger** (devnet wallet) | [7J888…4bYp transactions](https://explorer.solana.com/address/7J888M9EHynGgFTiWc9iSCbb5Nc89r1gGGMskhJv4bYp?cluster=devnet) |

Running on **Vultr** (API, lightning engine, GOES-19 lightning ingest, scheduler, Tiger sync behind HTTPS) with
**Tiger Cloud** for all data: 60 Florida plant sites, live weather and risk scores every 15 minutes, 10 years
of history (188,448 site-days, compressed 58.6%), forecast drift and "days like today" (pgvector).

What to try:
1. **Crew app:** sign in with Google, open your site, read tomorrow's briefing in **Español**, report a
   hazard with a photo. Gemini triages it in about 4 seconds. Accounts not on the crew list see the demo site.
2. **Dashboard → Crew reports:** the photo arrives live; confirm it, and the decision is written to Solana.
3. **Dashboard → Safety Ledger:** press **Verify** on any record to recompute its Merkle proof against the chain.
4. **Dashboard → site page → Simulate lightning strike:** the stop-work engine starts a 30-minute countdown,
   the crew app and the Site Beacon hardware react within seconds.

---

## Start here: pick your half

| You are | Go to | Setup |
|---|---|---|
| Frontend: Supervisor | [`frontend/`](frontend/README.md) → `frontend/supervisor/` | `./scripts/setup.sh frontend` |
| Frontend: Crew | [`frontend/crew-deepspace/`](frontend/crew-deepspace/START_HERE.md) | Follow the standalone crew setup guide |
| AI/ML + Solana | [`backend/`](backend/README.md) → `backend/ml/`, `backend/ai/`, `backend/ledger/` | `./scripts/setup.sh backend` |
| Backend / Platform | [`backend/`](backend/README.md) → `backend/api/`, `backend/workers/`, `backend/db/` | `./scripts/setup.sh backend` |

Frontend members need **Node**; the crew app also needs a DeepSpace account. Backend members need **conda + Docker**. Each half's README has the full
install guide, run commands, and troubleshooting.

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before your first PR (branches, ownership, shared files).

## Repo layout

```
CypressWatch/
├── frontend/   React apps (separate installs)
│   ├── supervisor/   supervisor dashboard          → localhost:5173
│   ├── crew-deepspace/   offline-first crew PWA        → DeepSpace dev URL
│   └── packages/          ui (shared components), shared (API types)
├── backend/   Python 3.11
│   ├── api/   FastAPI (one router file per owner)
│   ├── workers/   ingestion, lightning/flood engines, 6 PM scheduler
│   ├── db/  data/   TimescaleDB migrations/seeds, EIA-860M sites
│   ├── ml/   hazard-index model
│   ├── ai/   Gemini briefing, photo triage, explanations
│   └── ledger/   Solana Safety Ledger
├── hardware/site-beacon/   optional Arduino beacon (decided at hour 16)
├── docs/                       architecture.md, api-contract.md ← frontend ↔ backend agreement
└── scripts/                    setup.sh, check-env.sh  (take `frontend` / `backend` / nothing = both)
```

## Quick start

```bash
git clone https://github.com/AIForge10/CypressWatch && cd CypressWatch

# Supervisor frontend
nvm install 20 && nvm use 20
./scripts/setup.sh frontend
cd frontend && npm run dev:supervisor

# Crew frontend: separate terminal, Node 22.15+ and npm 11.6+
# Follow frontend/crew-deepspace/START_HERE.md for DeepSpace login and dev start.

# Backend
cd ..
cd backend && conda env create -f environment.yml && conda activate cypresswatch && cd ..
./scripts/setup.sh backend
cd backend/api && uvicorn app.main:app --reload        # http://localhost:8000/docs
```

Then fill in your `.env` / `.env.local` files with keys from the team (never commit them).

Account sign-ups (hour 0–2): **Auth0**, **DeepSpace**, **Gemini API key** at
https://aistudio.google.com, **Tiger Data** + **Vultr** + **NASA FIRMS key**.

## Team

| Area | Sponsor tech |
|---|---|
| Frontend: Supervisor | Easy On The Eyes, Auth0 |
| Frontend: Crew | DeepSpace, Hardware |
| AI/ML Lead | AI/ML, Gemini, Solana |
| Backend / Platform Lead | Sperry core, Tiger Data, Vultr |

CypressWatch is decision support for supervisors. It does not guarantee safety.

# CypressWatch AI & ML

**Rule: Gemini writes the words, code decides the facts.** Every number, hazard level and safety
decision comes from our model, our code or a supervisor. Gemini only explains, rewrites and reads photos,
and every Gemini answer is checked by code before anyone sees it.

## Hazard index (LightGBM, `backend/ml`)

- **Labels:** NOAA Storm Events (FL/GA/AL, 2015–2024) within 25 miles or the county of each site.
  **Weather:** Open-Meteo history. 188,448 site-days, 4.2% with a hazard event.
- **Model:** LightGBM on 14 features (rain over 1, 3, 7 and 30 days, gusts, heat, days since rain, season, location).
  Split by time: train 2015–2021, validate 2022, test 2023–2024.
- **Test results (2023–2024):**

| Model | ROC AUC | PR AUC | Brier |
|---|---|---|---|
| **LightGBM (ours)** | **0.889** | **0.358** | **0.033** |
| Month-only baseline | 0.664 | 0.065 | 0.040 |

- **Score 0–10** is a percentile: 8 means riskier than 80% of past site-days. SHAP values give the top
  reasons for each site. An active lightning stop-work always lifts a site's score to at least 9.

## Gemini: the right model for each job

| Job | Model | Why this model |
|---|---|---|
| Score explanation (every 15 min, 60 sites) | `gemini-3.8-flash` | High volume, short text: 20 sites per call, cached |
| 6 PM next-day briefing, English + Spanish | `gemini-4-argon` (demo) · Flash (dev) | Once per site per day; writing quality in two languages matters |
| Crew photo triage (vision) | `gemini-3.8-flash` | Fast enough to triage a report in about 4 s |

Models are set in `.env` (`GEMINI_FAST_MODEL`, `GEMINI_BRIEFING_MODEL`). If a model fails, the call
falls back to Flash, and if Gemini is down entirely, plain templates are used. The app never shows a blank.

## How each feature stays grounded

- **Explanations:** Gemini only rephrases the score and its SHAP reasons. The validator rejects numbers or
  hazards that aren't in the facts, any claim that work is "safe", and text over 240 characters.
- **Briefing:** code computes every fact from the hourly forecast: heat index peak, thunderstorm hours,
  gusts, rain, soil saturation and the best work window, each in English and Spanish with a source id.
  Gemini rewrites those facts. 10 checks run on the result (levels, hazards, numbers, sources,
  English in the Spanish, "safe" claims), code repairs spacing slips, Gemini gets one retry, and the
  bilingual template is the last fallback.
- **Photo triage:** the photo is resized and its GPS/EXIF data removed before upload. Gemini must choose
  from our 7 hazard types. Code safety rules **can only raise severity**: a downed power line or people
  in danger is always high, and visible lightning or fire is never low. The crew note is treated as data,
  never as instructions. A supervisor confirms every report.

## Evals (`backend/ai/evals/run_evals.py`)

| Feature | Guardrail tests | Live Gemini cases | Median latency |
|---|---|---|---|
| Explanations | 6/6 | 6/6 | 3.0 s (batch of 5) |
| Briefing EN+ES | 16/16 | 3/3 | 2.7 s |
| Photo triage | 15/15 | 5/5 (incl. prompt injection) | 2.5 s |

Guardrail tests feed bad outputs to the validators, which must reject all of them, and check the safety
rules and the fallbacks when Gemini is down. Live cases run real Gemini calls on real site data and photos.
Full report: [`evals/results/eval_report.md`](evals/results/eval_report.md).

    python backend/ai/evals/run_evals.py --offline   # free, no API calls
    python backend/ai/evals/run_evals.py             # + live Gemini cases

## Cost

Flash on the free tier for development and high-volume jobs. Argon only for the daily briefing in the demo,
about 60 calls a day. Results are cached, so unchanged sites and repeat photos cost nothing, and a
budget alert is set.

**Flash vs Argon on the briefing** (same 3 sites, same checks): both passed 3/3 in English and Spanish.
Flash: median 3.5 s. Argon: median 7.0 s, with more natural wording ("frequent past hazard reports in the
area", "1.9 inches"). The briefing runs once per site in the background at 6 PM, so we use Argon there
for quality, and Flash for the high-volume explanations and for photo triage, where speed matters.

**Solana devnet wallet:** `7J888M9EHynGgFTiWc9iSCbb5Nc89r1gGGMskhJv4bYp` · [all transactions](https://explorer.solana.com/address/7J888M9EHynGgFTiWc9iSCbb5Nc89r1gGGMskhJv4bYp?cluster=devnet)

## Tiger Data (TimescaleDB) — the timeline behind every safety decision

Safety depends on time: what is happening now, how the forecast is changing, whether a storm is
approaching, and what happened on days like today. CypressWatch keeps all of it in one Tiger Data service.

| Feature | Tiger Data capability | What the user sees |
|---|---|---|
| Live weather, forecasts, risk scores, lightning strikes for 60 sites every 15 min | **Hypertables** (1-day chunks) | Fast "last 48 hours" views |
| Hourly risk and weather charts | **Continuous aggregates** (real-time, auto-refresh every 15 min) | Dashboard trend charts with no batch jobs |
| Every forecast run kept, not overwritten | Time-series history of forecasts | **Forecast drift**: "10 PM rain chance rose from 44% to 69% since 6 AM" |
| 10 years of history (188,448 site-days, 2015–2024) | **Compression** (42 MB → 18 MB, 57% smaller) | Decade of history in the same database as live data |
| "Days like today" | **pgvector** (HNSW index) on 12-number weather fingerprints | "3 of the 10 most similar past days had flooding or high winds within 25 miles — 4× the usual rate" |
| Storm approach warning | `time_bucket` + `regr_slope` in SQL over the last 30 min of strikes | "Lightning 14 mi SW, moving in at ~15 mph — reaches the 10-mile stop-work line in ~16 min" |
| Lightning stop-work rule | Haversine distance query in SQL | Any strike within 10 mi → stop work until 30 min after the last strike |
| Storage stays small | **Compression policies** (after 7 days) and **retention policies** (forecasts 30 days, strikes 90 days) | No cleanup code |

**Tables:** `weather_obs`, `forecast_hourly`, `site_scores`, `lightning_strikes` (hypertables),
`weather_history` (compressed hypertable, 10 years), `history_vectors` (pgvector), `site_risk_hourly` and
`weather_hourly` (continuous aggregates), plus `sites`, `briefings`, `reports`, `site_analogs`.

**Why it matters:** the AI risk score says *how risky* today is. Tiger Data adds *how it is changing*
(forecast drift, storm approach) and *what happened before* (days like today), so supervisors can trust
and act on the warning.

**Run it:**

    python backend/db/cypress_db/db.py setup           # schema, hypertables, aggregates, policies
    python backend/db/cypress_db/db.py load --archive  # sites, weather runs, scores, briefings
    python backend/db/cypress_db/history.py load       # 10-year history + compression + vectors
    python backend/db/cypress_db/history.py refresh    # days like today for every site
    python backend/db/cypress_db/storm.py simulate <site_id>   # demo: approaching storm + ETA
    python backend/db/cypress_db/db.py check           # what the API will serve

## License

See [LICENSE](LICENSE).
