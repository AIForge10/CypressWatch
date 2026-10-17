# CypressWatch

> CypressWatch turns scattered weather, lightning, flood, fire, and wildlife data into one risk
> score per job site, stops work the moment lightning gets close, and keeps a tamper-proof safety
> record every company on the project can verify.

Built for **Sperry Tech PlanIT Control** at SwampHacks XII. The full plan is in [`docs/plan.pdf`](docs/plan.pdf).

---

## Start here: pick your half

| You are | Go to | Setup |
|---|---|---|
| **M1** Frontend: Supervisor | [`frontend/`](frontend/README.md) → `frontend/supervisor/` | `./scripts/setup.sh frontend` |
| **M2** Frontend: Crew | [`frontend/`](frontend/README.md) → `frontend/crew/` | `./scripts/setup.sh frontend` |
| **M3** AI/ML + Solana | [`backend/`](backend/README.md) → `backend/ml/`, `backend/ai/`, `backend/ledger/` | `./scripts/setup.sh backend` |
| **M4** Backend / Platform | [`backend/`](backend/README.md) → `backend/api/`, `backend/workers/`, `backend/db/` | `./scripts/setup.sh backend` |

Frontend members need **Node** only. Backend members need **conda + Docker**. Each half's README has the full
install guide, run commands, and troubleshooting.

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before your first PR (branches, ownership, shared files).

## Repo layout

```
CypressWatch/
├── frontend/              M1 + M2   React apps (npm workspaces)
│   ├── supervisor/        M1   supervisor dashboard          → localhost:5173
│   ├── crew/              M2   offline-first crew PWA        → localhost:5174
│   └── packages/          ui (shared components), shared (API types)
├── backend/               M3 + M4   Python 3.11
│   ├── api/               M4   FastAPI (one router file per owner)
│   ├── workers/           M4   ingestion, lightning/flood engines, 6 PM scheduler
│   ├── db/  data/         M4   TimescaleDB migrations/seeds, EIA-860M sites
│   ├── ml/                M3   hazard-index model
│   ├── ai/                M3   Gemini briefing, photo triage, explanations
│   └── ledger/            M3   Solana Safety Ledger
├── hardware/site-beacon/  M2   optional Arduino beacon (decided at hour 16)
├── docs/                       plan.pdf, architecture.md, api-contract.md ← frontend ↔ backend agreement
└── scripts/                    setup.sh, check-env.sh  (take `frontend` / `backend` / nothing = both)
```

## Quick start

```bash
git clone https://github.com/AIForge10/CypressWatch && cd CypressWatch

# Frontend (M1, M2)
nvm install 20 && nvm use 20
./scripts/setup.sh frontend
cd frontend && npm run dev:web

# Backend (M3, M4)
cd backend && conda env create -f environment.yml && conda activate cypresswatch && cd ..
./scripts/setup.sh backend
cd backend/api && uvicorn app.main:app --reload        # http://localhost:8000/docs
```

Then fill in your `.env` / `.env.local` files with keys from the team (never commit them).

Account sign-ups (hour 0–2): **Auth0** (M1), **DeepSpace** (M2), **Gemini API key** at
https://aistudio.google.com (M3), **Tiger Data** + **Vultr** + **NASA FIRMS key** (M4).

## Team

| | Role | Sponsors owned |
|---|---|---|
| M1 | Frontend: Supervisor | Easy On The Eyes, Auth0, Domain |
| M2 | Frontend: Crew | DeepSpace, Hardware |
| M3 | AI/ML Lead | AI/ML, Gemini, Solana |
| M4 | Backend / Platform Lead | Sperry core, Tiger Data, Vultr |

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
| Explanations | 6/6 | 6/6 | 2.8 s (batch of 5) |
| Briefing EN+ES | 16/16 | 3/3 | 3.5 s |
| Photo triage | 15/15 | 5/5 (incl. prompt injection) | 4.1 s |

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

## License

See [LICENSE](LICENSE).
