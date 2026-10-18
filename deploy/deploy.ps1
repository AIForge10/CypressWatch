<#
.SYNOPSIS
Deploy the CypressWatch backend stack (API + GLM + engine + scheduler) to a Vultr VPS.

.DESCRIPTION
Assumes the instance was provisioned with deploy/vultr/cloud-init.yaml (Vultr user data),
which created the `cypwatch` user, the venv at /opt/cypresswatch/backend/.venv and
/etc/cypresswatch.env. This script then:
  1. tar-packs backend/ (code + trained model; excludes venv, history, live state, ledger db/keys/.env)
  2. ships it via scp, swaps it in atomically on the server
  3. pip-installs the stack requirements in the venv
  4. installs the systemd units + env template, enables + restarts cypresswatch.target
  5. health-checks the API

First-run extras (script prints reminders):
  - scp your backend/ledger/.keys/devnet-keypair.json to the server, fund it with devnet SOL
    (faucet), or run `ledger.py setup` ON the server.
  - copy GEMINI_API_KEY / VULTR_S3_* into /etc/cypresswatch.env.

.EXAMPLE
powershell -File deploy\deploy.ps1 -HostIp 149.28.240.11
#>
param(
    [Parameter(Mandatory = $true)][string]$HostIp,
    [string]$SshKey = "$env:USERPROFILE\.ssh\id_ed25519",
    [string]$SshUser = "root"
)
$ErrorActionPreference = "Stop"
$root = if ($PSScriptRoot) { Split-Path $PSScriptRoot -Parent } else { (Get-Location).Path }
$opt = "/opt/cypresswatch"
function sshx([string]$cmd) { ssh -i $SshKey -o StrictHostKeyChecking=accept-new -o BatchMode=yes "$SshUser@$HostIp" $cmd }
function scpx($src, $dst) { scp -i $SshKey -o StrictHostKeyChecking=accept-new -r $src "${SshUser}@${HostIp}:${dst}" }
if (-not (Test-Path $SshKey)) { Write-Warning "ssh key $SshKey not found; using agent/default key list." }

Write-Host "== 1. packing backend ==" -ForegroundColor Cyan
$stage = "$env:TEMP\cypress_deploy_$(Get-Date -Format 'yyyyMMddHHmmss')"
New-Item -ItemType Directory $stage | Out-Null
tar -czf "$stage\backend.tgz" -C $root `
    --exclude 'backend/.venv' --exclude 'backend/ledger/data' --exclude 'backend/ledger/.keys' `
    --exclude 'backend/workers/data/history' --exclude 'backend/workers/data/live' `
    --exclude 'backend/api/.env' backend
Write-Host "   packed $stage\backend.tgz $([Math]::Round((Get-Item $stage\backend.tgz).Length / 1MB, 1)) MB -> shipping"

Write-Host "== 2. unpack + pip install ==" -ForegroundColor Cyan
scpx "$stage\backend.tgz" /tmp/backend.tgz
sshx "rm -rf $opt/backend_new && mkdir -p $opt/backend_new && tar -xzf /tmp/backend.tgz -C $opt/backend_new"
sshx "rsync -a --delete $opt/backend_new/ $opt/backend/ && rm -rf $opt/backend_new /tmp/backend.tgz"
sshx "chown -R cypwatch:cypwatch $opt"
sshx "$opt/backend/.venv/bin/pip install --upgrade pip -q"
sshx "$opt/backend/.venv/bin/pip install -q -r $opt/backend/requirements.txt -r $opt/backend/workers/requirements.txt -r $opt/backend/api/requirements.txt -r $opt/backend/ledger/requirements.txt -r $opt/backend/ml/requirements.txt"

Write-Host "== 3. systemd units + env ==" -ForegroundColor Cyan
scpx "$root\deploy\vultr" /tmp/cw-units
sshx "cp /tmp/cw-units/cypresswatch-*.service /tmp/cw-units/cypresswatch.target /etc/systemd/system/"
sshx "mkdir -p /etc/cypresswatch && cp /tmp/cw-units/cypresswatch.env.example /etc/cypresswatch.env.example && rm -rf /tmp/cw-units"
sshx "test -f /etc/cypresswatch.env || cp /etc/cypresswatch.env.example /etc/cypresswatch.env"
sshx "chown root:root /etc/cypresswatch.env && chmod 600 /etc/cypresswatch.env"
sshx "systemctl daemon-reload"

Write-Host "== 4. start + health check ==" -ForegroundColor Cyan
sshx "systemctl enable cypresswatch.target && systemctl restart cypresswatch.target"
Start-Sleep 6
sshx "systemctl --no-pager --plain list-units 'cypresswatch-*'"
sshx "curl -sf http://127.0.0.1:8000/health || journalctl -u cypresswatch-api --no-pager -n 20"

Write-Host "`nStack is live at http://${HostIp}:8000 (docs /docs, ws /api/ws)" -ForegroundColor Green
Write-Host "First-run reminders:"
Write-Host "  - ledger wallet:  scp backend/ledger/.keys/devnet-keypair.json ${SshUser}@${HostIp}:$opt/backend/ledger/.keys/"
Write-Host "                    then faucet devnet SOL; or run on the server: python backend/ledger/cypress_ledger/ledger.py setup"
Write-Host "  - env:            edit /etc/cypresswatch.env (GEMINI_API_KEY, VULTR_S3_*)"
Write-Host "  - firewall:       ufw allow 8000/tcp (and 22)"

Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
