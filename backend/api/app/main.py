"""CypressWatch API entrypoint.

Every router is already registered below, so you should NOT need to edit this
file — add endpoints inside the router file you own (see CODEOWNERS).
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.routers import alerts, briefings, ledger, reports, scores, simulate, sites

app = FastAPI(title="CypressWatch API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for module in (sites, scores, alerts, simulate, reports, briefings, ledger):
    app.include_router(module.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
