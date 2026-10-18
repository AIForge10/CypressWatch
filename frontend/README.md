# CypressWatch: Frontend

The supervisor app and shared packages use npm workspaces. The DeepSpace crew app is a separate project with its own dependencies, lockfile, sign-in, and development command.

```
frontend/
├── supervisor/   risk map, ranked list, site page, charts, Solana Verify page, Auth0 login   → :5173
├── crew-deepspace/   offline-first crew PWA, DeepSpace sign-in and live sync (standalone)
└── packages/
    ├── ui/   shared components + color tokens (import from '@cypresswatch/ui')
    └── shared/   API types matching docs/api-contract.md (import from '@cypresswatch/shared')
```

**Supervisor stack:** React, Vite, TypeScript, MapLibre GL + react-map-gl, React Router, Auth0 React SDK, Recharts, and `@solana/web3.js`. The crew app's own stack and setup are documented in [`crew-deepspace/START_HERE.md`](crew-deepspace/START_HERE.md).

## Setup (you only need Node, not Python or Docker)

1. Install **Node 20.19+** for the supervisor workspace: `nvm install 20 && nvm use` (there's a `.nvmrc` in this folder).
2. From the repo root:
   ```bash
   ./scripts/setup.sh frontend
   ```
   This runs `npm install` in `frontend/`, creates `supervisor/.env.local` from the example, and checks your machine.
3. Fill in `supervisor/.env.local` (Auth0 values etc.; get them from the team, never commit them).

For the crew app, follow [`crew-deepspace/START_HERE.md`](crew-deepspace/START_HERE.md). It requires Node 22.15+ and npm 11.6+, a separate install in `crew-deepspace/`, and DeepSpace sign-in. The supervisor setup script does not install it.

## Run

```bash
cd frontend
npm run dev:supervisor     # http://localhost:5173
npm run typecheck
npm run build
```

Run the crew app separately from `frontend/crew-deepspace/` with `npm run dev` after its setup. The supervisor uses `VITE_API_URL` (default `http://localhost:8000`). The crew app still defaults to demo data; its backend mode needs an auth integration before it can share the same live API.

The supervisor login page links to the deployed crew app. Set `VITE_CREW_APP_URL` in `supervisor/.env.local` if that URL changes. Crew users who land in the supervisor shell see a handoff page instead of the old placeholder screens; they must sign in separately to DeepSpace.

## Adding a package

```bash
cd frontend
npm install <pkg> -w @cypresswatch/supervisor
cd crew-deepspace && npm install <pkg>
```

`npm warn allow-scripts …` during install is harmless (optional native speedups). On a
`package-lock.json` merge conflict, see `CONTRIBUTING.md`.
