#!/usr/bin/env bash
# Verifies a teammate's machine is ready. From the repo root:
#   ./scripts/check-env.sh frontend | backend | (nothing = both)
cd "$(dirname "$0")/.." || exit 1
PART="${1:-all}"
ok() { printf "  \033[32m✓\033[0m %s\n" "$1"; }
bad() { printf "  \033[31m✗\033[0m %s\n" "$1"; FAIL=1; }
opt() { printf "  \033[33m–\033[0m %s\n" "$1"; }
envf() { [ -f "$1" ] && ok "$1" || opt "$1 not created yet (copy from its .env.example)"; }
FAIL=0

echo "Common"
command -v git >/dev/null && ok "git" || bad "git missing"

if [[ "$PART" == frontend || "$PART" == all ]]; then
  echo "Frontend"
  if command -v node >/dev/null; then
    v=$(node -p 'process.versions.node')
    node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=19)?0:1)' \
      && ok "node $v" || bad "node $v (need >= 20.19, run: nvm install 20)"
  else bad "node missing"; fi
  [ -d frontend/node_modules/@cypresswatch/ui ] && ok "npm packages installed" || bad "run: cd frontend && npm install"
  envf frontend/supervisor/.env.local
  envf frontend/crew/.env.local
fi

if [[ "$PART" == backend || "$PART" == all ]]; then
  echo "Backend"
  if command -v python >/dev/null && python -c 'import sys; sys.exit(0 if sys.version_info[:2]==(3,11) else 1)'; then
    ok "python $(python -V 2>&1 | cut -d' ' -f2) ($(command -v python))"
  else bad "python 3.11 not active (conda activate cypresswatch)"; fi
  python -c "import fastapi, psycopg, pandas, lightgbm, xgboost, shap, google.genai, solders, xarray" 2>/dev/null \
    && ok "python packages import" || bad "python packages missing/broken (cd backend && pip install -r requirements.txt)"
  if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
    ok "docker running"
    docker ps --format '{{.Names}}' | grep -q '^cypresswatch-db$' && ok "cypresswatch-db container up" \
      || opt "db not running (cd backend && docker compose up -d)"
  else opt "docker not running (only needed for the local DB)"; fi
  command -v solana >/dev/null && ok "solana $(solana --version | cut -d' ' -f2)  [M3]" || opt "solana CLI  [M3 only]"
  command -v anchor >/dev/null && ok "$(anchor --version)  [M3]" || opt "anchor CLI  [M3 only; new terminal or: source ~/.cargo/env]"
  envf backend/api/.env
  envf backend/workers/.env
  envf backend/ai/.env
fi

[ $FAIL = 0 ] && echo -e "\nReady to go." || { echo -e "\nFix the ✗ items above."; exit 1; }
