# Deployment (Vultr)

One Vultr VPS runs the API and the workers as systemd services, behind **Caddy** for HTTPS (free
Let's Encrypt certificate, renewed automatically). The database is the **Tiger Cloud** service, not the
local Docker one. Both frontends stay where they are and point `VITE_API_URL` at the HTTPS address.

```
phones / browsers ──HTTPS──> Caddy :443 ──> API 127.0.0.1:8000 ──> Tiger Cloud
                                            scheduler ─ engine ─ GLM ─ sync (workers)
```

## No server yet? Run it from a laptop

`scripts/demo_stack.sh` starts the API (if needed), scheduler and Tiger sync, and publishes the API over HTTPS
with a free Cloudflare quick tunnel (no account). It prints a `https://….trycloudflare.com` URL for the crew app.
The laptop must stay on and the URL changes on every restart, so move to the server below for the real demo.

## Files

| File | Role |
|---|---|
| `deploy.sh` | macOS / Linux: pack, ship, install, HTTPS, firewall, start, health check |
| `deploy.ps1` | Windows (PowerShell) equivalent without HTTPS; prefer `deploy.sh` from WSL or Git Bash |
| `vultr/cloud-init.yaml` | Vultr user data: Python, `cypwatch` user, `/opt/cypresswatch`, venv |
| `vultr/cypresswatch-api.service` | FastAPI on `127.0.0.1:8000` (Caddy is the only public entry) |
| `vultr/cypresswatch-glm.service` | GOES lightning ingest, every 60 s |
| `vultr/cypresswatch-engine.service` | stop-work engine, every 5 s |
| `vultr/cypresswatch-scheduler.service` | weather → scores → explanations, hourly ledger anchor, 6 PM briefings |
| `vultr/cypresswatch-sync.service` | pushes live data to Tiger every 5 min, so the API serves fresh data |
| `vultr/cypresswatch.target` | starts / restarts all five together |
| `vultr/Caddyfile` | HTTPS reverse proxy (domain filled in by `deploy.sh`) |
| `vultr/cypresswatch.env.example` | server settings template → `/etc/cypresswatch.env` |

## Walkthrough (macOS)

### 0. Once: Tiger Cloud tables
The server uses `TIGER_DATABASE_URL`. Create the schema and load the data from your laptop:

```bash
cd backend
export DATABASE_URL="$(grep ^TIGER_DATABASE_URL= api/.env | cut -d= -f2-)"
python db/cypress_db/db.py setup            # tables, hypertables, aggregates, policies
python db/cypress_db/db.py load --archive   # sites, weather runs, scores, briefings
python db/cypress_db/history.py load        # 10-year history + compression + vectors
python db/cypress_db/history.py refresh     # "days like today" for every site
unset DATABASE_URL
```

### 1. SSH key
```bash
ls ~/.ssh/id_ed25519.pub || ssh-keygen -t ed25519      # press Enter for the defaults
pbcopy < ~/.ssh/id_ed25519.pub                          # copies the public key
```
At vultr.com → **Account → SSH Keys → Add SSH Key**, paste it.

### 2. Create the server
vultr.com → **Deploy +** → **Cloud Compute – Shared CPU**:
- Location: close to Florida (e.g. **Miami** or **Atlanta**)
- Image: **Ubuntu 24.04 LTS x64**
- Plan: **2 vCPU / 4 GB** (the model and Gemini client need more than 1 GB)
- SSH key: the one from step 1
- **Cloud-Init User-Data**: paste all of `deploy/vultr/cloud-init.yaml`
- Hostname: `cypresswatch`

Deploy, wait until it says **Running**, copy the IP address. Give cloud-init about 2 minutes to finish.

### 3. Deploy
```bash
deploy/deploy.sh <IP> --push-env --wallet
```
- `--push-env` copies your local keys (Tiger URL, Gemini, Auth0, crew list) into `/etc/cypresswatch.env`
  on the server, only where the server's value is empty. Nothing is printed.
- `--wallet` copies the Solana devnet wallet so the server keeps anchoring with the same address.

It ends with `Live: https://<ip-with-dashes>.sslip.io`. Open `https://<that>/docs` to check.
Have your own domain? Point an A record at the IP and add `--domain api.yourdomain.com`.

### 4. Point the apps at it
- Supervisor: `VITE_API_URL=https://<ip-with-dashes>.sslip.io` in `frontend/supervisor/.env.local`, restart `npm run dev`.
- Crew (M2): same `VITE_API_URL`, plus `VITE_USE_MOCKS=false`.
- Auth0 (M1): nothing changes for the API; the supervisor app still runs from `localhost:5173`.

### Redeploy after code changes
```bash
deploy/deploy.sh <IP>
```
Live data, the ledger database, the wallet and crew photos on the server are never overwritten.

## Day-to-day on the server
```bash
ssh root@<IP>
systemctl status cypresswatch-api            # or -scheduler, -engine, -glm, -sync, caddy
journalctl -u cypresswatch-api -f            # live logs
nano /etc/cypresswatch.env && systemctl restart cypresswatch.target   # change a setting
```

## Troubleshooting
| Symptom | Check |
|---|---|
| `deploy.sh` says no venv | cloud-init has not finished: wait 2 min, or check `cloud-init status` on the server |
| HTTPS not answering | `journalctl -u caddy -n 30` — ports 80 and 443 must be open (the script runs `ufw`) |
| API 503 "auth not configured" | `AUTH0_DOMAIN` empty in `/etc/cypresswatch.env` |
| Data stays Stale | `journalctl -u cypresswatch-sync -n 30` and `-u cypresswatch-scheduler` |
| Crew gets 403 "not on the crew list" | add their email to `CREW_ASSIGNMENTS`, restart the target |
