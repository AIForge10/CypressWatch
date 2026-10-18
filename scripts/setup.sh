#!/usr/bin/env bash
# One-shot setup after cloning. Run from the repo root:
#   ./scripts/setup.sh frontend   # supervisor + shared packages (needs Node only)
#   ./scripts/setup.sh backend
#   ./scripts/setup.sh            # both
set -euo pipefail
cd "$(dirname "$0")/.."
PART="${1:-all}"

if [[ "$PART" == frontend || "$PART" == all ]]; then
  echo "→ Frontend: npm install (supervisor and shared packages)"
  (cd frontend && npm install)
  [ -f frontend/supervisor/.env.local ] || cp frontend/supervisor/.env.example frontend/supervisor/.env.local
  echo "  Crew app is separate: see frontend/crew-deepspace/START_HERE.md"
fi

if [[ "$PART" == backend || "$PART" == all ]]; then
  echo "→ Backend: pip install"
  (cd backend && python -m pip install -r requirements.txt)
  for svc in backend/api backend/workers backend/ai; do
    [ -f "$svc/.env" ] || cp "$svc/.env.example" "$svc/.env"
  done
  echo "→ Backend: local database"
  if docker info >/dev/null 2>&1; then (cd backend && docker compose up -d)
  else echo "  Docker not running; skip (later: cd backend && docker compose up -d)"; fi
fi

./scripts/check-env.sh "$PART"
