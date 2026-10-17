# Working together without conflicts

## 1. Stay in your half, and in your folder

| Team | Member | Owns |
|---|---|---|
| **Frontend** | **M1** Supervisor | `frontend/supervisor/`, `backend/api/app/auth/` (Auth0 middleware) |
| | **M2** Crew | `frontend/crew/`, `backend/api/app/routers/reports.py` (upload endpoint), `hardware/` |
| | M1 + M2 | `frontend/packages/ui/` (shared components + colors) |
| **Backend** | **M3** AI/ML + Solana | `backend/ml/`, `backend/ai/`, `backend/ledger/`, routers `scores.py`, `briefings.py`, `ledger.py` |
| | **M4** Platform | everything else in `backend/` (api, workers, db, data), `docs/api-contract.md`, `frontend/packages/shared/` |

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
| `docs/api-contract.md` + `frontend/packages/shared/src` | **The only bridge between frontend and backend.** Agree on an endpoint here first; frontend mocks it while backend builds it. M4 merges changes. |
| `backend/api/app/main.py` | Every router is pre-registered. Add endpoints in **your router file**, don't edit `main.py`. |
| `backend/requirements.txt` | Only `-r` includes. Add Python packages to **your area's** `requirements.txt`. |
| `frontend/package.json` | Add JS packages to your app: `cd frontend && npm install <pkg> -w @cypresswatch/crew`. |
| `frontend/package-lock.json` | On conflict don't hand-merge: `git checkout --theirs frontend/package-lock.json && (cd frontend && npm install)`, then commit. |
| `backend/db/migrations/` | New file per change, named with a UTC timestamp (`20261017T0130_add_alerts.sql`). Never edit a merged migration. |
| `frontend/packages/ui/` | M1 + M2 agree before changing tokens or a shared component's props. |

## 4. Secrets

- Each app/service has its own `.env.example`. Copy it to `.env` (`.env.local` for the frontend apps) and fill it in.
- Real keys go in the team password manager or DM, **never** in git, Devpost, or screenshots.
- Solana keypairs stay in `~/.config/solana/`, never in the repo.

## 5. Rules from the plan

- Every feature gets a simple working version before anything is polished. Feature freeze at hour 30.
- Rules decide alerts, the model decides scores, Gemini only explains; AI never starts or ends a stop-work.
- The server enforces every role check; hiding a button is not security.
- Show source timestamps everywhere; never call stale data live. Label demo injections as simulated.
