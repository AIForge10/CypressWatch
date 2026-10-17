# CypressWatch: Backend (M3 + M4)

Python 3.11 services, the ML model, the Solana ledger, and the database.

```
backend/
├── api/               M4  FastAPI. Routers are pre-registered in app/main.py; each owner edits only their file:
│   └── app/
│       ├── auth/             M1  Auth0 JWT verification, roles, step-up MFA
│       └── routers/
│           ├── sites.py, alerts.py, simulate.py    M4
│           ├── scores.py, briefings.py, ledger.py  M3
│           └── reports.py                          M2  (crew photo upload)
├── workers/           M4  ingestion pollers, lightning + flood engines, 6 PM scheduler
├── ai/                M3  Gemini: EN/ES briefing, photo triage, score explanations, evals
├── ml/                M3  hazard-index model: data, notebooks, training, SHAP, reports
├── ledger/            M3  Solana Safety Ledger: Merkle hashing + Anchor program (devnet)
├── db/                M4  TimescaleDB migrations + seeds
├── data/              M4  static inputs (EIA-860M plant list)
├── docker-compose.yml     local TimescaleDB + PostGIS (port 5433)
├── environment.yml        conda env
└── requirements.txt       includes every area's own requirements.txt
```

**Stack:** FastAPI, Uvicorn, psycopg 3, PyJWT, boto3 (Vultr Object Storage), APScheduler, xarray + netCDF4
(GOES GLM lightning), timezonefinder, pandas, scikit-learn, LightGBM, XGBoost, SHAP, JupyterLab,
`google-genai`, `solana` + `solders`, Anchor (Rust).

## Setup

1. Install [Miniconda](https://docs.anaconda.com/miniconda/) and [Docker Desktop](https://www.docker.com/products/docker-desktop/).
2. Create the Python env (Python 3.11 + every dependency + the OpenMP runtime LightGBM needs):
   ```bash
   cd backend
   conda env create -f environment.yml
   conda activate cypresswatch
   cd ..
   ```
3. From the repo root:
   ```bash
   ./scripts/setup.sh backend
   ```
   This re-syncs pip packages, creates `api/.env`, `workers/.env`, `ai/.env` from the examples,
   starts the local database, and checks your machine.
4. Fill in your `.env` files (get the keys from the team, never commit them).

<details>
<summary>No conda? Use a venv</summary>

```bash
cd backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
brew install libomp          # macOS only, for LightGBM
```
</details>

## Run

| What | Command (from `backend/`) | URL |
|---|---|---|
| API | `cd api && uvicorn app.main:app --reload` | http://localhost:8000/docs |
| Local DB | `docker compose up -d` (stop: `docker compose down`) | `postgresql://postgres:password@localhost:5433/cypresswatch` |
| DB shell | `docker exec -it cypresswatch-db psql -U postgres -d cypresswatch` | |
| Notebooks | `jupyter lab ml/notebooks` | |

TimescaleDB and PostGIS are both available (`CREATE EXTENSION IF NOT EXISTS timescaledb;` / `postgis;`).
If port 5433 is taken: `DB_PORT=5434 docker compose up -d`, then update `DATABASE_URL`.

## Adding a package

Add the name to **your area's** `requirements.txt` (e.g. `ml/requirements.txt`), then run
`pip install -r requirements.txt` from `backend/`.

## Solana / Anchor (M3 only)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y   # Rust
source ~/.cargo/env
cargo install --git https://github.com/solana-foundation/anchor avm --force --locked
avm install latest && avm use latest
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"                # Solana CLI

solana config set --url devnet
solana-keygen new -o ~/.config/solana/id.json   # stays outside the repo
solana airdrop 2
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `Library not loaded: libomp.dylib` | `conda install -n cypresswatch -c conda-forge llvm-openmp` (venv: `brew install libomp`) |
| `port is already allocated` | `DB_PORT=5434 docker compose up -d` |
| `anchor: command not found` | Open a new terminal or `source ~/.cargo/env` |
| Imports fail | `conda activate cypresswatch`, then `./scripts/check-env.sh backend` from the repo root |
