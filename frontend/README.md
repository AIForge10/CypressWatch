# CypressWatch: Frontend (M1 + M2)

Two React apps plus shared packages, installed together through npm workspaces.

```
frontend/
├── supervisor/        M1  risk map, ranked list, site page, charts, Solana Verify page, Auth0 login   → :5173
├── crew/              M2  offline-first PWA: local countdown, saved briefing/map, photo reports, DeepSpace → :5174
└── packages/
    ├── ui/            M1+M2  shared components + color tokens (import from '@cypresswatch/ui')
    └── shared/        M4     API types matching docs/api-contract.md (import from '@cypresswatch/shared')
```

**Stack:** React 19, Vite 8, TypeScript, Tailwind 4, MapLibre GL + react-map-gl, Turf.js, TanStack Query,
React Router, Auth0 React SDK. Supervisor app also has Recharts + `@solana/web3.js`. Crew app also has
vite-plugin-pwa + Dexie (IndexedDB) for offline use.

## Setup (you only need Node, not Python or Docker)

1. Install **Node 20.19+**: `nvm install 20 && nvm use` (there's a `.nvmrc` in this folder).
2. From the repo root:
   ```bash
   ./scripts/setup.sh frontend
   ```
   This runs `npm install` in `frontend/`, creates `supervisor/.env.local` and `crew/.env.local`
   from the examples, and checks your machine.
3. Fill in your `.env.local` (Auth0 values etc.; get them from the team, never commit them).

## Run

```bash
cd frontend
npm run dev:supervisor     # http://localhost:5173
npm run dev:crew           # http://localhost:5174
npm run dev:web            # both at once
npm run typecheck
npm run build
```

The apps call the API at `VITE_API_URL` (default `http://localhost:8000`). If the backend isn't running
yet, mock the responses from `docs/api-contract.md`.

## Adding a package

```bash
cd frontend
npm install <pkg> -w @cypresswatch/supervisor   # M1
npm install <pkg> -w @cypresswatch/crew         # M2
```

`npm warn allow-scripts …` during install is harmless (optional native speedups). On a
`package-lock.json` merge conflict, see `CONTRIBUTING.md`.
