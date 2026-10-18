"""Auth0 access-token verification and authorization dependencies.

The API is the security boundary. Browser role checks are only navigation
conveniences, so every protected endpoint derives identity, role, site access,
and step-up MFA state from a validated access token.
"""
from __future__ import annotations

import json
import urllib.request
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from time import time
from typing import Any

import jwt
from cryptography.hazmat.primitives.serialization import load_pem_public_key
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import InvalidTokenError, PyJWKClient, PyJWKClientError

from app.core.config import settings

bearer_scheme = HTTPBearer(auto_error=False)
VALID_ROLES = frozenset({"supervisor", "crew", "owner"})


@dataclass(frozen=True)
class AuthenticatedUser:
    """The minimum trusted identity projected from a verified access token."""

    user_id: str
    name: str
    email: str | None
    role: str
    site_ids: frozenset[str]
    claims: dict[str, Any]

    def can_access_site(self, site_id: str) -> bool:
        return "*" in self.site_ids or site_id in self.site_ids

    @property
    def has_fresh_mfa(self) -> bool:
        """Accept only a recent MFA event embedded in the signed access token."""
        mfa_at = self.claims.get(settings.auth0_mfa_at_claim)
        if not isinstance(mfa_at, (int, float)):
            return False
        return (
            mfa_at <= time() + 30
            and time() - mfa_at <= settings.auth0_mfa_max_age_seconds
        )


class TokenValidationError(Exception):
    """A safe, client-facing reason for rejecting an access token."""

    def __init__(self, detail: str, status_code: int = status.HTTP_401_UNAUTHORIZED):
        self.detail = detail
        self.status_code = status_code
        super().__init__(detail)


def _normalized_domain() -> str | None:
    domain = settings.auth0_domain
    if not domain:
        return None
    return domain.removeprefix("https://").removeprefix("http://").rstrip("/")


def _issuer() -> str | None:
    if settings.auth0_issuer:
        return settings.auth0_issuer.rstrip("/") + "/"
    domain = _normalized_domain()
    return f"https://{domain}/" if domain else None


def _jwks_url() -> str | None:
    domain = _normalized_domain()
    return f"https://{domain}/.well-known/jwks.json" if domain else None


@lru_cache(maxsize=4)
def _jwks_client(url: str) -> PyJWKClient:
    # PyJWT refreshes keys when an unfamiliar key id is encountered.
    return PyJWKClient(url, cache_keys=True)


def _signing_key(token: str, jwks_url: str):
    """Use Auth0's live JWKS, or an explicitly configured local public-key cache."""
    if not settings.auth0_jwks_path:
        return _jwks_client(jwks_url).get_signing_key_from_jwt(token).key
    kid = jwt.get_unverified_header(token).get("kid")
    if not isinstance(kid, str) or not kid:
        raise TokenValidationError("Access token is missing a signing key ID.")
    jwks = jwt.PyJWKSet.from_json(Path(settings.auth0_jwks_path).read_text())
    for key in jwks.keys:
        if key.key_id == kid and key.public_key_use in (None, "sig"):
            return key.key
    raise TokenValidationError("Access token signing key is not in the configured JWKS cache.")


def _role_from_claim(value: object) -> str | None:
    values = value if isinstance(value, list) else [value]
    for candidate in values:
        if not isinstance(candidate, str):
            continue
        normalized = candidate.lower().replace("-", "_").replace(" ", "_")
        if normalized == "project_owner":
            return "owner"
        if normalized in VALID_ROLES:
            return normalized
    return None


def _site_ids_from_claim(value: object) -> frozenset[str]:
    if not isinstance(value, list):
        return frozenset()
    return frozenset(item for item in value if isinstance(item, str) and item)


def _user_from_claims(claims: dict[str, Any]) -> AuthenticatedUser:
    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject:
        raise TokenValidationError("Access token is missing a subject.")
    role = _role_from_claim(claims.get(settings.auth0_role_claim, claims.get("role")))
    if role is None:
        raise TokenValidationError("Access token has no recognized CypressWatch role.", status.HTTP_403_FORBIDDEN)
    name = claims.get("name") or claims.get("nickname") or claims.get("email") or subject
    email = claims.get("email")
    return AuthenticatedUser(
        user_id=subject,
        name=name if isinstance(name, str) else subject,
        email=email if isinstance(email, str) else None,
        role=role,
        site_ids=_site_ids_from_claim(claims.get(settings.auth0_site_ids_claim, claims.get("site_ids"))),
        claims=claims,
    )


# ---------- DeepSpace crew tokens ----------
# The crew app signs in with DeepSpace (ES256, one platform-wide key and issuer for every DeepSpace app).
# A verified token proves the email; the role is always "crew" and sites come only from CREW_ASSIGNMENTS.

def crew_assignments() -> dict[str, frozenset[str]]:
    """CREW_ASSIGNMENTS "a@x.com:site_621|site_56407,b@y.com:*" -> {email: site ids}."""
    out: dict[str, frozenset[str]] = {}
    for entry in settings.crew_assignments.split(","):
        email, _, sites = entry.strip().partition(":")
        if email and sites:
            out[email.strip().lower()] = frozenset(s.strip() for s in sites.split("|") if s.strip())
    return out


@lru_cache(maxsize=4)
def _deepspace_key(source: str):
    """PEM public key from DEEPSPACE_PUBLIC_KEY, or fetched once from the DeepSpace JWKS URL ({"publicKey": PEM})."""
    pem = settings.deepspace_public_key
    if not pem:
        req = urllib.request.Request(source, headers={"User-Agent": "CypressWatch-API/1.0", "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as res:  # noqa: S310 - fixed https URL from settings
            pem = json.loads(res.read())["publicKey"]
    return load_pem_public_key(pem.replace("\\n", "\n").encode())


def _authenticate_deepspace(token: str) -> AuthenticatedUser:
    try:
        key = _deepspace_key(settings.deepspace_jwks_url)
    except (OSError, ValueError, KeyError) as error:
        raise TokenValidationError("Crew sign-in keys are unavailable right now.", status.HTTP_503_SERVICE_UNAVAILABLE) from error
    try:
        claims = jwt.decode(token, key, algorithms=["ES256"], issuer=settings.deepspace_issuer,
                            options={"require": ["exp", "sub"], "verify_aud": False})
    except InvalidTokenError as error:
        raise TokenValidationError("Invalid or expired crew sign-in token.") from error
    parties = {p.strip() for p in settings.deepspace_authorized_parties.split(",") if p.strip()}
    if parties:
        aud = claims.get("aud")
        presented = {claims.get("azp"), *(aud if isinstance(aud, list) else [aud])} - {None}
        if not presented & parties:
            raise TokenValidationError("This sign-in token was issued for a different app.")
    email = claims.get("email")
    sites = crew_assignments().get(email.strip().lower()) if isinstance(email, str) else None
    if not sites:
        shown = email if isinstance(email, str) else "an account with no email"
        print(f"crew sign-in refused: {shown} is not on CREW_ASSIGNMENTS", flush=True)  # lets an admin add them
        raise TokenValidationError(f"Signed in as {shown}, but this account is not on the CypressWatch crew list. "
                                   "Ask a supervisor to add this email.", status.HTTP_403_FORBIDDEN)
    name = claims.get("name") or email
    return AuthenticatedUser(user_id=f"deepspace|{claims['sub']}", name=name if isinstance(name, str) else email,
                             email=email, role="crew", site_ids=sites, claims=claims)


def _is_deepspace(token: str) -> bool:
    """Route by the (unverified) header and issuer; the chosen path then verifies everything."""
    try:
        header = jwt.get_unverified_header(token)
        issuer = jwt.decode(token, options={"verify_signature": False}).get("iss")
    except InvalidTokenError:
        return False
    return header.get("alg") == "ES256" and issuer == settings.deepspace_issuer


def authenticate_access_token(token: str) -> AuthenticatedUser:
    """Verify signature, issuer, audience and registered claims before use (Auth0, or a DeepSpace crew token)."""
    if _is_deepspace(token):
        return _authenticate_deepspace(token)
    audience = settings.auth0_audience
    issuer = _issuer()
    jwks_url = _jwks_url()
    if not audience or not issuer or not jwks_url:
        raise TokenValidationError("Auth0 verification is not configured on this API.", status.HTTP_503_SERVICE_UNAVAILABLE)
    try:
        header = jwt.get_unverified_header(token)
        if header.get("alg") != "RS256":
            raise TokenValidationError("Unsupported access-token signing algorithm.")
        signing_key = _signing_key(token, jwks_url)
        claims = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            audience=audience,
            issuer=issuer,
            options={"require": ["exp", "iat", "sub"]},
        )
    except TokenValidationError:
        raise
    except (InvalidTokenError, PyJWKClientError, OSError, ValueError) as error:
        raise TokenValidationError("Invalid or expired access token.") from error
    return _user_from_claims(claims)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> AuthenticatedUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "unauthorized", "message": "Bearer access token required."},
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        return authenticate_access_token(credentials.credentials)
    except TokenValidationError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"error": "unauthorized" if error.status_code == 401 else "auth_unavailable" if error.status_code == 503 else "forbidden", "message": error.detail},
            headers={"WWW-Authenticate": "Bearer"} if error.status_code == 401 else None,
        ) from error


def require_roles(*roles: str):
    allowed = frozenset(roles)

    def dependency(user: AuthenticatedUser = Depends(get_current_user)) -> AuthenticatedUser:
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"error": "forbidden", "message": "Your role cannot perform this action."},
            )
        return user

    return dependency


def require_site_access(user: AuthenticatedUser, site_id: str) -> None:
    if not user.can_access_site(site_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "forbidden", "message": "You are not assigned to this site."},
        )
