"""Settings loaded from backend/api/.env (see .env.example)."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://postgres:password@localhost:5433/cypresswatch"
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:5174"]


settings = Settings()
