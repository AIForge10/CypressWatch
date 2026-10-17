"""Shared Gemini setup for every CypressWatch AI feature.

Settings come from the backend .env file (backend/api/.env, or a .env in the repo root):
    GEMINI_API_KEY=...
    GEMINI_FAST_MODEL=gemini-3.8-flash       # explanations, photo triage, evals
    GEMINI_BRIEFING_MODEL=gemini-3.8-flash   # 6 PM briefing; set to gemini-4-argon for the demo

generate_json() asks a model for JSON that matches a Pydantic schema. If the chosen model fails
(quota, billing, outage), it retries once on the fast model, so the app keeps working.
"""
import json
import os
import time
from functools import lru_cache
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from google import genai
from google.genai import types

AI_DIR = Path(__file__).resolve().parents[1]          # backend/ai
BACKEND = AI_DIR.parent
REPO = BACKEND.parent
for env_file in (BACKEND / "api" / ".env", REPO / ".env", BACKEND / ".env"):
    if env_file.exists():
        load_dotenv(env_file)
        break

FAST_MODEL = os.environ.get("GEMINI_FAST_MODEL", "gemini-3.8-flash")
BRIEFING_MODEL = os.environ.get("GEMINI_BRIEFING_MODEL", FAST_MODEL)


@lru_cache(maxsize=1)
def client() -> genai.Client:
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("GEMINI_API_KEY not found. Put it in backend/api/.env")
    return genai.Client(api_key=key)


def generate_json(prompt: str | list, schema: Any, model: str = FAST_MODEL,
                  thinking_level: str = "low", system: str | None = None) -> tuple[Any, dict]:
    """Return (parsed JSON, info). info records the model used, latency and any fallback, for logs and evals."""
    attempts = [model] + ([FAST_MODEL] if model != FAST_MODEL else [])
    last_error = None
    for m in attempts:
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=schema,
            system_instruction=system,
            thinking_config=types.ThinkingConfig(thinking_level=thinking_level),
            temperature=0.2,
        )
        start = time.perf_counter()
        try:
            response = client().models.generate_content(model=m, contents=prompt, config=config)
            data = json.loads(response.text)
            return data, {"model": m, "latency_s": round(time.perf_counter() - start, 2),
                          "fallback": m != model, "error": None}
        except Exception as e:  # noqa: BLE001 - any failure moves on to the fallback model
            last_error = f"{m}: {type(e).__name__}: {str(e)[:200]}"
    raise RuntimeError(f"All Gemini models failed. Last error: {last_error}")