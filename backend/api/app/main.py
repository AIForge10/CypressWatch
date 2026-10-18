import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.routers import alerts, briefings, ledger, reports, scores, simulate, sites


@asynccontextmanager
async def lifespan(_app: FastAPI):
    from app.realtime import start_watcher  # tails workers/data/live/events.json once the loop is up
    start_watcher()
    yield


app = FastAPI(title="CypressWatch API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for module in (sites, scores, alerts, simulate, reports, briefings, ledger):
    app.include_router(module.router)

from app.realtime import router as realtime_router  # /api/ws (registered after startup wiring)
app.include_router(realtime_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
