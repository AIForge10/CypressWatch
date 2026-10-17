"""Demo injection: simulate strike, heat spike, heavy rain, fire (owner: M4)."""

from fastapi import APIRouter

router = APIRouter(prefix="/simulate", tags=["simulate"])
