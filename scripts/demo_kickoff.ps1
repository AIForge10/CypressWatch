<#
.SYNOPSIS
Boots the live CypressWatch stack and walks the supervisor story end to end.

.DESCRIPTION
Starts (separate processes, so you can also run them alone):
  1. uvicorn API (port 8000)          backend/api
  2. GLM ingest (--loop 60)           backend/workers
  3. Stop-work engine (--loop 5)      backend/workers  (only writer of alert state)
  4. Scheduler (chain/anchor/briefs)  backend/workers
Then, once /health is up, it walks the LI on-chain story:
  demo strike -> active stop-work -> acknowledge -> Auth0 step-up override ->
  ledger anchor (records + memo tx on devnet) -> verify a record (prints explorer link).

.PARAMETER Demo
Run the scripted walkthrough after boot. Default on; -NoDemo skips it.
.PARAMETER Site
Site used for the demo strikes (default site_56407 = West County Energy Center).
.PARAMETER UI
Also start the supervisor frontend (npm run dev, port 5173).
.PARAMETER AccessToken
Auth0 access token for a supervisor assigned to the selected site. Defaults to
the CYPRESSWATCH_DEMO_ACCESS_TOKEN environment variable.
.PARAMETER StepUpAccessToken
Fresh Auth0 access token issued after MFA. Defaults to
CYPRESSWATCH_DEMO_STEP_UP_ACCESS_TOKEN. Required only for the scripted override.

.EXAMPLE
powershell -File scripts\demo_kickoff.ps1 -Site site_621
#>
param(
    [switch]$NoDemo,
    [string]$Site = "site_56407",
    [switch]$UI,
    [string]$AccessToken = $env:CYPRESSWATCH_DEMO_ACCESS_TOKEN,
    [string]$StepUpAccessToken = $env:CYPRESSWATCH_DEMO_STEP_UP_ACCESS_TOKEN
)
$ErrorActionPreference = "Stop"
if ($PSScriptRoot) { $root = Split-Path $PSScriptRoot -Parent } else { $root = (Get-Location).Path }

function Start-Stack([string]$name, [string]$workdir, [string[]]$argList) {
    Write-Host "starting $name..." -ForegroundColor Cyan
    $p = Start-Process -FilePath "python" -ArgumentList $argList -WorkingDirectory $workdir `
        -WindowStyle Minimized -PassThru -RedirectStandardOutput "$env:TEMP\cypress_$name.log" `
        -RedirectStandardError "$env:TEMP\cypress_$name.err.log"
    return $p
}

if ($env:VIRTUAL_ENV -eq $null -and (Test-Path "$root\backend\.venv")) {
    & "$root\backend\.venv\Scripts\Activate.ps1"
}

$workers = "$root\backend\workers"
$api     = "$root\backend\api"
$procs = @()
$procs += Start-Stack "api"       $api      @("-m","uvicorn","app.main:app","--port","8000")
$procs += Start-Stack "glm"       $workers  @("-m","cypress_workers.ingest.lightning_glm","--loop","60")
$procs += Start-Stack "engine"    $workers  @("-m","cypress_workers.engines.lightning","--loop","5","--glm-poll","60","--satellite","19")
$procs += Start-Stack "scheduler" $workers  @("-m","cypress_workers.scheduler.scheduler")
if ($UI) {
    Write-Host "starting supervisor UI (vite, port 5173)..." -ForegroundColor Cyan
    Start-Process -FilePath "cmd" -ArgumentList "/c","npm run dev" -WorkingDirectory "$root\frontend\supervisor" -WindowStyle Minimized
}

Write-Host "waiting for http://localhost:8000/health..."
$up = $false
foreach ($i in 1..45) {
    try { $h = Invoke-RestMethod http://localhost:8000/health -TimeoutSec 2; if ($h.status -eq "ok") { $up = $true; break } } catch {}
    Start-Sleep 1
}
if (-not $up) { Write-Host "API did not come up; check %TEMP%\cypress_api.err.log" -ForegroundColor Red; exit 1 }
Write-Host "stack is up: api :8000, ws /api/ws, glm + engine + scheduler running" -ForegroundColor Green

if ($NoDemo) { return }

if (-not $AccessToken) {
    Write-Host "Demo actions need an Auth0 supervisor access token. Start the UI and complete Auth0 login, or rerun with -AccessToken / CYPRESSWATCH_DEMO_ACCESS_TOKEN." -ForegroundColor Yellow
    return
}

$H = @{ Authorization = "Bearer $AccessToken" }
Write-Host "`n--- 1. queue a simulated lightning strike at $Site ---" -ForegroundColor Yellow
Invoke-RestMethod -Method Post -Uri http://localhost:8000/api/demo/strike -Headers $H `
    -ContentType "application/json" -Body (@{ site_id = $Site; distance_miles = 4.2 } | ConvertTo-Json) | Out-Null

Write-Host "--- 2. engine must start the stop-work within one 5 s tick ---" -ForegroundColor Yellow
$alert = $null
foreach ($i in 1..15) {
    Start-Sleep 2
    $alerts = (Invoke-RestMethod "http://localhost:8000/api/alerts?status=active&site_id=$Site").alerts
    if ($alerts.Count) { $alert = $alerts[0]; break }
}
if (-not $alert) { Write-Host "no active alert appeared; check engine log %TEMP%\cypress_engine.err.log" -ForegroundColor Red; exit 1 }
Write-Host ("  STOP-WORK active: {0}  until {1}" -f $alert.alert_id, $alert.stop_work_until)

Write-Host "--- 3. supervisor acknowledges ---" -ForegroundColor Yellow
$ack = Invoke-RestMethod -Method Post -Headers $H -Uri "http://localhost:8000/api/alerts/$($alert.alert_id)/acknowledge"
Write-Host "  acknowledged at $($ack.acknowledged_by.at)"

Write-Host "--- 4. override without MFA must fail (401 step_up_required) ---" -ForegroundColor Yellow
try {
    Invoke-RestMethod -Method Post -Headers $H -ContentType "application/json" -Body '{"reason":"scud cloud in the path"}' `
        -Uri "http://localhost:8000/api/alerts/$($alert.alert_id)/override" | Out-Null
    Write-Host "  UNEXPECTED: override accepted without MFA" -ForegroundColor Red
} catch {
    Write-Host "  refused as designed (401 step_up_required)" -ForegroundColor Green
}

Write-Host "--- 5. override with step-up MFA ---" -ForegroundColor Yellow
if (-not $StepUpAccessToken) {
    Write-Host "  skipped: use the supervisor UI to complete MFA, then rerun with -StepUpAccessToken." -ForegroundColor Yellow
    return
}
$stepUpHeaders = @{ Authorization = "Bearer $StepUpAccessToken" }
$over = Invoke-RestMethod -Method Post -Headers $stepUpHeaders -ContentType "application/json" -Body '{"reason":"scud cloud in the path"}' `
    -Uri "http://localhost:8000/api/alerts/$($alert.alert_id)/override"
Write-Host "  override accepted, ledger record: $($over.ledger_record_id)"

Write-Host "--- 6. anchor the already-recorded decisions on Solana devnet ---" -ForegroundColor Yellow
Push-Location "$root\backend"
try {
    python -c "import sys; sys.path.insert(0, r'workers'); from cypress_workers.scheduler.anchor import anchor_period; print(' ', anchor_period())"
    python "$root\backend\ledger\cypress_ledger\ledger.py" anchor
    if ($over.ledger_record_id) {
        python "$root\backend\ledger\cypress_ledger\ledger.py" verify $over.ledger_record_id
    } else {
        python "$root\backend\ledger\cypress_ledger\ledger.py" verify (python -c "import sqlite3; print(sqlite3.connect(r'ledger\data\ledger.db').execute('SELECT record_id FROM records ORDER BY created_at DESC LIMIT 1').fetchone()[0])")
    }
} finally { Pop-Location }
Write-Host "`nDemo complete. The verify output above carries the devnet explorer link (or 'not anchored yet' if the memo is still confirming)." -ForegroundColor Green
Write-Host ("UI: open http://localhost:5173 (supervisor > site detail > ledger page). API: http://localhost:8000/docs. WS: ws://localhost:8000/api/ws") 
Write-Host "Processes kept running; PID list:"  ($procs.Id -join ", ")
Write-Host "Stop with: Get-Process -Id <pids> | Stop-Process   (logs in %TEMP%\cypress_*.log)"
