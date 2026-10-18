# DeepSpace + Auth0 check (hour 0-2 item)

Status: NOT CONFIRMED. Treat as "does not work directly" until proven otherwise.

- DeepSpace issues its own login tokens (Better Auth). The app worker verifies them with
  platform-set `AUTH_JWT_PUBLIC_KEY` / `AUTH_JWT_ISSUER`.
- No Auth0, OIDC or external-issuer option appears in the SDK types, README or changelog (deepspace 0.42.3).
- docs.deep.space could not be reached from the build sandbox, so the docs were not checked.

To settle it: search docs.deep.space/llms-full.txt for "auth0", "oidc", "external issuer"; or ask the
DeepSpace team at the sponsor table: "Can the worker trust an Auth0-issued JWT?"

Fallback that keeps "never add a second login": crews use the DeepSpace login; Auth0 stays on the
supervisor side (roles + step-up MFA in our API middleware).

Contract v0.1 note: it assumes every API call carries an Auth0 bearer token and goes to a separate REST
backend. Decide with M1/M4 whether crew uses Auth0 for REST (DeepSpace only for live sync) or the
backend accepts DeepSpace tokens for crew.
