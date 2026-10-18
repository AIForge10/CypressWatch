"""Settings loaded from backend/api/.env (see .env.example)."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://postgres:password@localhost:5433/cypresswatch"
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ]

    # Auth0 API resource-server settings. The API fails closed when these are
    # absent: local UI mock mode then falls back to its clearly labelled demo.
    auth0_domain: str | None = None
    auth0_audience: str | None = None
    auth0_issuer: str | None = None
    # Optional development cache when the API cannot reach Auth0's public JWKS.
    # Leave unset on deployed hosts so key rotation is fetched automatically.
    auth0_jwks_path: str | None = None
    auth0_role_claim: str = "https://cypresswatch.app/role"
    auth0_site_ids_claim: str = "https://cypresswatch.app/site_ids"
    auth0_mfa_at_claim: str = "https://cypresswatch.app/mfa_at"
    auth0_mfa_max_age_seconds: int = 300


settings = Settings()
