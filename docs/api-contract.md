# API contract (owner: M4)

The single source of truth between the frontends and the backend. Agree on an endpoint
here **before** building both sides, so M1/M2 can mock it while M3/M4 implement it.
Mirror request/response types in `frontend/packages/shared/src`.

Live, auto-generated docs while the API runs: http://localhost:8000/docs

| Router file | Prefix | Owner | Endpoints (fill in) |
|---|---|---|---|
| `sites.py` | `/sites` | M4 | |
| `scores.py` | `/scores` | M3 | |
| `alerts.py` | `/alerts` | M4 | |
| `simulate.py` | `/simulate` | M4 | |
| `reports.py` | `/reports` | M2 | |
| `briefings.py` | `/briefings` | M3 | |
| `ledger.py` | `/ledger` | M3 | |

## Realtime events (DeepSpace, M2)

| Event | Payload | Sent by |
|---|---|---|
| | | |
