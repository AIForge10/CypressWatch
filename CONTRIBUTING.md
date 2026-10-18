# Working together without conflicts

## 1. Stay in your half, and in your folder

| Team | Member | Owns |
|---|---|---|
| **Frontend** | Supervisor | `frontend/supervisor/`, `backend/api/app/auth/` (Auth0 middleware) |
| | Crew | `frontend/crew-deepspace/`, `backend/api/app/routers/reports.py` (upload endpoint), `hardware/` |
| | Both frontends | `frontend/packages/ui/` (shared components + colors) |
| **Backend** | AI/ML + Solana | `backend/ml/`, `backend/ai/`, `backend/ledger/`, routers `scores.py`, `briefings.py`, `ledger.py` |
| | Platform | everything else in `backend/` (api, workers, db, data), `docs/api-contract.md`, `frontend/packages/shared/` |

`.github/CODEOWNERS` enforces this on GitHub. If you must touch someone else's folder,
message them first.

## 2. Branches

- Never commit to `main` directly. One branch per task: `m1/site-map`, `m3/gemini-briefing`, `m4/lightning-engine`.
- Keep PRs small and merge often (at least every few hours). Long-lived branches cause conflicts.
- Before opening a PR, run `git fetch origin && git rebase origin/main`.
- The folder owner approves changes to their folder.

## 3. The few shared files, and how to treat them

| File | Rule |
|---|---|
| `docs/api-contract.md` + `frontend/packages/shared/src` | **The only bridge between frontend and backend.** Agree on an endpoint here first; frontend mocks it while backend builds it. Platform merges changes. |
| `backend/api/app/main.py` | Every router is pre-registered. Add endpoints in **your router file**, don't edit `main.py`. |
| `backend/requirements.txt` | Only `-r` includes. Add Python packages to **your area's** `requirements.txt`. |
| `frontend/package.json` | Supervisor/shared packages use the root npm workspace. The crew app has its own manifest and lockfile: install crew packages from `frontend/crew-deepspace/`. |
| `frontend/package-lock.json` | On conflict, resolve the manifest first, then regenerate the lockfile with `npm install --package-lock-only` in `frontend/`. Crew has a separate lockfile. |
| `backend/db/migrations/` | New file per change, named with a UTC timestamp (`20261017T0130_add_alerts.sql`). Never edit a merged migration. |
| `frontend/packages/ui/` | Both frontends agree before changing tokens or a shared component's props. |

## 4. Secrets

- Follow each app/service's own environment instructions. The supervisor uses `.env.local`; the standalone crew app documents its `.env` in `frontend/crew-deepspace/START_HERE.md`.
- Real keys go in the team password manager or DM, **never** in git, Devpost, or screenshots.
- Solana keypairs stay in `~/.config/solana/`, never in the repo.

## 5. Rules from the plan

- Every feature gets a simple working version before anything is polished. Feature freeze at hour 30.
- Rules decide alerts, the model decides scores, Gemini only explains; AI never starts or ends a stop-work.
- The server enforces every role check; hiding a button is not security.
- Show source timestamps everywhere; never call stale data live. Label demo injections as simulated.
