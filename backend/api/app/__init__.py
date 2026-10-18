"""API package. Adds the workers dir to sys.path first, so the routers can share
cypress_workers.common (the JSON state under backend/workers/data/live) with plain
`cd api && uvicorn app.main:app`. Auth adds the backend/ai and backend/workers paths as needed.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
BACKEND = HERE.parents[2]
WORKERS = BACKEND / "workers"
for p in (str(WORKERS),):
    if p not in sys.path:
        sys.path.insert(0, p)
