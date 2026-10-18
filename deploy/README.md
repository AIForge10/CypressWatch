# Deployment (Vultr)

The workers + API run as four systemd services on one Vultr VPS. Frontend stays with you
(supervisor UI points `VITE_API_URL=http://<ip>:8000`); the ledger wallet and dev SOL
provision per-instance (never in git).

## Files

| File | Role |
|---|---|
| `vultr/cloud-init.yaml` | Vultr user data: OS packages, `cypwatch` user, `/opt/cypresswatch`, venv, `/etc/cypresswatch.env` skeleton |
| `vultr/cypresswatch-api.service` | `uvicorn app.main:app --port 8000` (backend/api) |
| `vultr/cypresswatch-glm.service` | GLM ingest `--loop 60` (backend/workers) |
| `vultr/cypresswatch-engine.service` | stop-work engine tick 5 s (backend/workers) |
| `vultr/cypresswatch-scheduler.service` | weather/score/anchor/briefing clock (backend/workers) |
| `vultr/cypresswatch.target` | group control: `systemctl restart cypresswatch.target` restarts all four |
| `vultr/cypresswatch.env.example` | server env template (systemd `EnvironmentFile`) |
| `deploy.ps1` | pack + ship + install + start + health-check |

## Server creation (once)

```powershell
# Option A (console): create instance at vultr.com, Ubuntu 22.04+, add your SSH key,
# then paste cloud-init.yaml as User data in the instance settings.
# Option B (cli):  vultr-cli instance create --plan vc2-2c-4gb --region ewr --os-ubuntu-22-04-x64 \
#                  --ssh-keys <id> --userdata "$(Get-Content deploy/vultr/cloud-init.yaml -Raw)"
```

## Deploy / redeploy (code changes)

```powershell
powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -HostIp <IP>
```

Rolling updates only; `Restart=always` keeps the stack self-healing. Live state
(`backend/workers/data/live`, ledger db, keypair) is intentionally excluded from shipping
tarballs, so redeploys never wipe alert history.

## Post-deploy checklist

1. `ssh root@<IP>` → edit `/etc/cypresswatch.env` (GEMINI_API_KEY, VULTR_S3_*).
2. Ledger wallet: either scp `backend/ledger/.keys/devnet-keypair.json` up (and fund it with
   devnet SOL via faucet), or run `python backend/ledger/cypress_ledger/ledger.py setup` on
   the server and use faucet for the printed address.
3. `ufw allow 8000/tcp`; keep 22.
4. Verify: `curl http://<IP>:8000/api/sites/summary` and open the UI with
   `VITE_API_URL=http://<IP>:8000` → `npm run dev (frontend/supervisor)`.
5. Demo walkthrough: `scripts/demo_kickoff.ps1` for local; on the server, strike via
   `POST http://<IP>:8000/api/demo/strike`.
