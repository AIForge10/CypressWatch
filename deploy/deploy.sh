#!/usr/bin/env bash
# Deploy the CypressWatch backend (API + GLM + engine + scheduler + Tiger sync) to a Vultr VPS, behind HTTPS.
# macOS / Linux counterpart of deploy.ps1. See deploy/README.md.
#
#   deploy/deploy.sh <server-ip> [--domain api.example.com] [--key ~/.ssh/id_ed25519] [--push-env] [--wallet]
#
#   --domain    HTTPS name for the API. Default: <ip-with-dashes>.sslip.io (resolves to the IP; no DNS setup).
#   --push-env  copy values from your local backend/api/.env, backend/workers/.env and backend/ai/.env into the
#               server's /etc/cypresswatch.env, for keys that are still empty there (never prints them).
#   --wallet    copy backend/ledger/.keys/devnet-keypair.json so the server anchors with the same Solana wallet.
#
# Safe to re-run: live data, the ledger database, the wallet and crew photos on the server are never touched.
set -euo pipefail

usage() { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
[[ $# -ge 1 && $1 != -* ]] || usage
HOST_IP=$1; shift
DOMAIN="${HOST_IP//./-}.sslip.io"; SSH_KEY="$HOME/.ssh/id_ed25519"; SSH_USER=root; PUSH_ENV=0; WALLET=0
while [[ $# -gt 0 ]]; do
  case $1 in
    --domain) DOMAIN=$2; shift 2 ;;
    --key) SSH_KEY=$2; shift 2 ;;
    --user) SSH_USER=$2; shift 2 ;;
    --push-env) PUSH_ENV=1; shift ;;
    --wallet) WALLET=1; shift ;;
    *) usage ;;
  esac
done

ROOT=$(cd "$(dirname "$0")/.." && pwd)
OPT=/opt/cypresswatch
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
[[ -f $SSH_KEY ]] && SSH_OPTS+=(-i "$SSH_KEY")
sshx() { ssh "${SSH_OPTS[@]}" "$SSH_USER@$HOST_IP" "$@"; }
scpx() { scp "${SSH_OPTS[@]}" -q "$@"; }
step() { printf '\n\033[36m== %s ==\033[0m\n' "$1"; }

# Server-side state that is never shipped and must survive every redeploy.
KEEP=(.venv ledger/data ledger/.keys workers/data/history workers/data/live data/reports)

step "1. checking the server"
sshx "test -d $OPT/backend/.venv" || { echo "No $OPT/backend/.venv on $HOST_IP. Create the server with deploy/vultr/cloud-init.yaml first."; exit 1; }
sshx "command -v caddy >/dev/null && command -v rsync >/dev/null && command -v ufw >/dev/null" || {
  echo "   installing caddy, rsync, ufw (first run only)"
  sshx 'set -e; export DEBIAN_FRONTEND=noninteractive
        apt-get update -qq && apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gnupg rsync ufw >/dev/null
        curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
        curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
        apt-get update -qq && apt-get install -y -qq caddy >/dev/null'
}

step "2. packing backend/"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
# Training data and notebooks are not needed to serve (scoring uses ml/models); keeps the upload small.
EXCLUDES=(--exclude='.env' --exclude='__pycache__' --exclude='*.pyc' --exclude='.DS_Store'
          --exclude='backend/ml/data' --exclude='backend/ml/notebooks')
for k in "${KEEP[@]}"; do EXCLUDES+=(--exclude="backend/$k"); done
# macOS tar would add Mac-only metadata that Linux tar warns about on every file.
[[ $(uname) == Darwin ]] && EXCLUDES+=(--no-mac-metadata --no-xattrs)
COPYFILE_DISABLE=1 tar -czf "$STAGE/backend.tgz" -C "$ROOT" "${EXCLUDES[@]}" backend
echo "   $(du -h "$STAGE/backend.tgz" | cut -f1) -> $HOST_IP"

step "3. shipping and installing Python packages"
scpx "$STAGE/backend.tgz" "$SSH_USER@$HOST_IP:/tmp/backend.tgz"
RSYNC_KEEP=$(printf -- "--exclude=/%s " "${KEEP[@]}")
sshx "set -e; rm -rf $OPT/backend_new && mkdir -p $OPT/backend_new && tar -xzf /tmp/backend.tgz -C $OPT/backend_new
      rsync -a --delete $RSYNC_KEEP $OPT/backend_new/backend/ $OPT/backend/
      rm -rf $OPT/backend_new /tmp/backend.tgz
      mkdir -p $OPT/backend/ledger/data $OPT/backend/ledger/.keys $OPT/backend/workers/data/live $OPT/backend/data/reports
      chown -R cypwatch:cypwatch $OPT"
# Per-component requirements only: backend/requirements.txt also pulls hardware/ and dev tools, which are not shipped.
sshx "set -e; $OPT/backend/.venv/bin/pip install -q --upgrade pip
      cd $OPT/backend && .venv/bin/pip install -q -r api/requirements.txt -r workers/requirements.txt \
        -r ai/requirements.txt -r ml/requirements.txt -r ledger/requirements.txt"

step "4. services, HTTPS and firewall"
scpx -r "$ROOT/deploy/vultr" "$SSH_USER@$HOST_IP:/tmp/cw-units"
sshx "set -e; cp /tmp/cw-units/cypresswatch-*.service /tmp/cw-units/cypresswatch.target /etc/systemd/system/
      cp /tmp/cw-units/cypresswatch.env.example /etc/cypresswatch.env.example
      test -s /etc/cypresswatch.env && grep -q DATABASE_URL /etc/cypresswatch.env || cp /etc/cypresswatch.env.example /etc/cypresswatch.env
      chown root:root /etc/cypresswatch.env && chmod 600 /etc/cypresswatch.env
      sed 's/{\$CW_DOMAIN}/$DOMAIN/' /tmp/cw-units/Caddyfile > /etc/caddy/Caddyfile
      rm -rf /tmp/cw-units
      ufw allow OpenSSH >/dev/null && ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null && ufw --force enable >/dev/null
      systemctl daemon-reload"

if [[ $PUSH_ENV == 1 ]]; then
  step "   copying local settings into /etc/cypresswatch.env (only keys still empty on the server)"
  python3 - "$ROOT" > "$STAGE/local.env" <<'PY'
import re, sys
root = sys.argv[1]
skip = {"AUTH0_JWKS_PATH"}  # local-only path
vals = {}
for f in ("backend/ai/.env", "backend/workers/.env", "backend/api/.env"):  # later files win
    try:
        for line in open(f"{root}/{f}"):
            m = re.match(r"^([A-Z0-9_]+)=(.+)$", line.strip())
            if m and m[1] not in skip and m[2].strip():
                vals[m[1]] = m[2].strip()
    except FileNotFoundError:
        pass
# The server has no local Docker database: it always uses the Tiger Cloud service.
if "TIGER_DATABASE_URL" in vals:
    vals["DATABASE_URL"] = vals["TIGER_DATABASE_URL"]
elif "localhost" in vals.get("DATABASE_URL", "") or "127.0.0.1" in vals.get("DATABASE_URL", ""):
    sys.exit("Local DATABASE_URL points at localhost; set TIGER_DATABASE_URL in backend/api/.env first.")
print("\n".join(f"{k}={v}" for k, v in vals.items()))
PY
  scpx "$STAGE/local.env" "$SSH_USER@$HOST_IP:/tmp/cw-local.env"
  sshx 'python3 - <<"PY"
import re
env, local = "/etc/cypresswatch.env", "/tmp/cw-local.env"
new = dict(l.split("=", 1) for l in open(local).read().splitlines() if "=" in l)
lines, seen, filled = open(env).read().splitlines(), set(), []
for i, line in enumerate(lines):
    m = re.match(r"^([A-Z0-9_]+)=(.*)$", line)
    if m:
        seen.add(m[1])
        if not m[2].strip() and m[1] in new:
            lines[i] = f"{m[1]}={new[m[1]]}"; filled.append(m[1])
extra = [k for k in new if k not in seen]
lines += [f"{k}={new[k]}" for k in extra]
open(env, "w").write("\n".join(lines) + "\n")
print("   filled:", ", ".join(filled + extra) or "nothing (server values kept)")
PY
rm -f /tmp/cw-local.env'
fi

if [[ $WALLET == 1 ]]; then
  KEY_FILE="$ROOT/backend/ledger/.keys/devnet-keypair.json"
  [[ -f $KEY_FILE ]] || { echo "No $KEY_FILE"; exit 1; }
  scpx "$KEY_FILE" "$SSH_USER@$HOST_IP:$OPT/backend/ledger/.keys/devnet-keypair.json"
  sshx "chown cypwatch:cypwatch $OPT/backend/ledger/.keys/devnet-keypair.json && chmod 600 $OPT/backend/ledger/.keys/devnet-keypair.json"
  echo "   ledger wallet copied"
fi

step "5. starting"
sshx "set -e; systemctl enable -q cypresswatch.target cypresswatch-api cypresswatch-glm cypresswatch-engine cypresswatch-scheduler cypresswatch-sync caddy
      systemctl restart cypresswatch.target && systemctl reload-or-restart caddy
      sleep 4; systemctl --no-pager --plain list-units 'cypresswatch-*' caddy.service"

step "6. health check over HTTPS (the first certificate can take ~30 s)"
for i in $(seq 1 20); do
  if curl -sf --max-time 5 "https://$DOMAIN/health" >/dev/null; then
    printf '\n\033[32mLive: https://%s   (docs: /docs, live feed: wss://%s/api/ws)\033[0m\n' "$DOMAIN" "$DOMAIN"
    cat <<EOF

Next:
  - Supervisor app: VITE_API_URL=https://$DOMAIN in frontend/supervisor/.env.local
  - Crew app (M2):  VITE_API_URL=https://$DOMAIN and VITE_USE_MOCKS=false
  - Settings:       ssh $SSH_USER@$HOST_IP, edit /etc/cypresswatch.env, then: systemctl restart cypresswatch.target
  - Logs:           ssh $SSH_USER@$HOST_IP journalctl -u cypresswatch-api -f
EOF
    exit 0
  fi
  sleep 3
done
echo "HTTPS not answering yet. Check: ssh $SSH_USER@$HOST_IP 'journalctl -u caddy -n 30; journalctl -u cypresswatch-api -n 30'"
exit 1
