"""Who is calling: Auth0 access token -> contract Me (used by GET /api/me).

AUTH0_DOMAIN set   -> the Bearer token must be a valid Auth0 access token (RS256, our audience), else 401.
AUTH0_DOMAIN empty -> demo mode: no token needed. Header X-Demo-Role: crew | supervisor | project_owner
                      picks the demo user (default supervisor).
Claims match the supervisor app: https://cypresswatch.app/role and https://cypresswatch.app/site_ids.
A supervisor or project owner with no site_ids claim may see every site; crew only see their listed sites.
"""
from functools import lru_cache

import jwt

from app.core.config import settings
from app.routers.common import now_iso
from cypress_db import db

CLAIM = "https://cypresswatch.app/"
ROLES = {"supervisor": "supervisor", "crew": "crew", "project_owner": "project_owner", "owner": "project_owner"}
DEMO_CREW_SITE = "site_621"  # Turkey Point: has live scores and reports for the demo


class AuthError(Exception):
    pass


@lru_cache(maxsize=1)
def _jwks() -> jwt.PyJWKClient:
    return jwt.PyJWKClient(f"https://{settings.auth0_domain}/.well-known/jwks.json")


def _verify(token: str) -> dict:
    try:
        key = _jwks().get_signing_key_from_jwt(token).key
        return jwt.decode(token, key, algorithms=["RS256"], audience=settings.auth0_audience,
                          issuer=f"https://{settings.auth0_domain}/")
    except jwt.PyJWTError as e:
        raise AuthError(f"Invalid token: {e}") from e


def _all_site_ids() -> list[str]:
    with db.conn() as c:
        return [r["site_id"] for r in c.execute("SELECT site_id FROM sites ORDER BY site_id").fetchall()]


def _me(user_id: str, name: str, role: str, site_ids: list[str] | None, language: str) -> dict:
    if not site_ids and role != "crew":
        site_ids = _all_site_ids()
    return {"user_id": user_id, "name": name, "role": role, "site_ids": site_ids or [],
            "language": language, "server_time": now_iso()}


def current_user(authorization: str | None, demo_role: str | None = None) -> dict:
    """Return the contract Me for this request. Raises AuthError when a token is required but bad or missing."""
    if not settings.auth0_domain:
        role = ROLES.get((demo_role or "supervisor").lower(), "supervisor")
        if role == "crew":
            return _me("demo|crew", "Field crew", "crew", [DEMO_CREW_SITE], "en")
        return _me(f"demo|{role}", "Demo " + role.replace("_", " "), role, None, "en")

    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise AuthError("Sign in required: send an Auth0 access token as 'Authorization: Bearer <token>'.")
    claims = _verify(token)
    role = ROLES.get(str(claims.get(CLAIM + "role") or claims.get("role") or ""))
    if not role:
        raise AuthError("Your account has no CypressWatch role. Ask an admin to assign one.")
    site_ids = [s for s in claims.get(CLAIM + "site_ids") or [] if isinstance(s, str)]
    language = claims.get(CLAIM + "language") or ("es" if str(claims.get("locale", "")).startswith("es") else "en")
    name = claims.get(CLAIM + "name") or claims.get("name") or claims.get("email") or claims["sub"]
    return _me(claims["sub"], name, role, site_ids, "es" if language == "es" else "en")
