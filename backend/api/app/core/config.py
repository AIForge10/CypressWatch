"""Settings loaded from backend/api/.env (see .env.example)."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://postgres:password@localhost:5433/cypresswatch"
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:5174"]
    auth0_domain: str = ""                       # empty = demo mode (GET /api/me returns a demo user)
    auth0_audience: str = "https://api.cypresswatch"


settings = Settings()
