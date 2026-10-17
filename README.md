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

## License

See [LICENSE](LICENSE).
