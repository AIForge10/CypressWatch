# Auth0-protected CypressWatch API

The supervisor SPA authenticates a user with Auth0, requests an access token for the
`https://api.cypresswatch` audience, and sends it in `Authorization: Bearer <token>` on
every API request. The FastAPI service validates the signed token itself; it never trusts
browser-supplied user, role, site, or MFA headers.

## Configure the Auth0 API

1. In **Auth0 Dashboard → Applications → APIs**, create or update the CypressWatch API with
   identifier `https://api.cypresswatch`. This exact value is both the Auth0 API Identifier
   and `VITE_AUTH0_AUDIENCE` / `AUTH0_AUDIENCE`.
2. Set `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, and `VITE_AUTH0_AUDIENCE` in
   `frontend/supervisor/.env.local`.
3. Set `AUTH0_DOMAIN` and `AUTH0_AUDIENCE` in `backend/api/.env` locally and
   `/etc/cypresswatch.env` on Vultr. `AUTH0_ISSUER` is optional; when omitted, the API uses
   `https://<AUTH0_DOMAIN>/`.
4. Add the Vultr API origin and local development origins to the Auth0 application's Allowed
   Web Origins / Allowed Callback URLs as appropriate for the deployed SPA.

If a local development sandbox cannot reach Auth0's JWKS endpoint, set
`AUTH0_JWKS_PATH` to an absolute path containing a current copy of that tenant's
public `https://<AUTH0_DOMAIN>/.well-known/jwks.json`. The API still validates
the JWT signature, issuer, audience, and expiry. Leave this option unset on
deployed hosts so Auth0 signing-key rotation is fetched automatically. Refresh
the local copy if the tenant rotates keys; an unknown key ID fails closed.

## Post-Login Action

The Action lives in [`deploy/auth0/post-login-action.js`](../deploy/auth0/post-login-action.js). Paste it
into the CypressWatch claims Action (Actions → Library), add the secret below, click **Deploy**, and make sure
it is in **Actions → Triggers → post-login**, after any Action that runs an MFA challenge. It puts the same
claims on the ID token (supervisor UI navigation) and the access token (API enforcement):
`https://cypresswatch.app/role`, `https://cypresswatch.app/site_ids` and `https://cypresswatch.app/mfa_at`.

| Secret (Action → Settings → Secrets) | Value |
|---|---|
| `TEAM_SUPERVISOR_EMAILS` | Comma-separated team emails, e.g. `a@gmail.com,b@ufl.edu` |

Where a user's role comes from (first match wins):

1. **`app_metadata.role` / `app_metadata.site_ids`** on that user: the most specific; use it for crew and
   owners. Must be `app_metadata` (only admins can edit it), not `user_metadata` (users can edit it).
2. **Auth0 Roles** (User Management → Roles) named `supervisor`, `crew` or `owner`.
3. **`TEAM_SUPERVISOR_EMAILS`** with a **verified** email → `supervisor` on every site (`"*"`). Google
   sign-ins are verified; email/password sign-ups must click the verification email first.

Anyone else gets no role: the supervisor app shows **Access restricted** with their email, sign-in method
and Auth0 user id plus the exact `app_metadata` to set, and the API answers `403`. Roles are read at sign-in,
so a user must sign out and back in after a change.

Roles are `supervisor`, `crew` or `owner` (`project_owner` is accepted). `site_ids` must contain IDs from
`backend/data/sites/sites.json` (for example `site_56407`), or `"*"` for every site. The old UI demo IDs such
as `site-01` are not backend site IDs and will return no assigned sites.

A successful login with `200 OK` from `/api/sites/summary` but an empty `sites` array means the signed token
has no site IDs matching the backend catalog.

### Why one teammate works and another sees "Access restricted"

Roles belong to each **Auth0 user**, not to the app, so the same code behaves differently per account:

- The role was saved in `user_metadata` instead of `app_metadata` (the Action ignores `user_metadata`).
- The same email exists twice: "Continue with Google" (`google-oauth2|…`) and email/password (`auth0|…`)
  are separate users. The Access restricted screen shows which one you signed in with.
- The email is on the allowlist but not verified yet.
- The change was made while signed in: sign out and back in.

### Dashboard checklist (M1)

- [ ] Applications → CypressWatch supervisor → Allowed Callback URLs, Logout URLs and Web Origins include
      `http://localhost:5173` and the deployed URL.
- [ ] APIs → identifier exactly `https://api.cypresswatch` (no trailing slash).
- [ ] Post-Login Action deployed with `TEAM_SUPERVISOR_EMAILS` set, and in the post-login flow.
- [ ] Authentication → Database → Username-Password-Authentication → **Disable Sign Ups**, so only invited
      accounts exist (Google sign-ins still get no role unless allowlisted).
- [ ] A shared **demo supervisor** account for judges, with `app_metadata` `{"role": "supervisor", "site_ids": ["*"]}`,
      so the live demo does not depend on a personal login.

The API allows a stop-work override only for a `supervisor` assigned to the alert's site.
It additionally requires a valid signed `mfa_at` timestamp no older than five minutes. The UI requests
reauthentication with `max_age=0`; the API is still the final authority and fails closed when a required
claim is absent or stale.

For every-login or step-up MFA, configure the Auth0 Post-Login MFA policy/Action so the
completion is available in `event.authentication.methods` before this claim-setting Action runs.
Do not change the API to accept a browser header as a shortcut. Auth0 supports namespaced custom claims on both ID and access
tokens through Post-Login Actions, and its FastAPI guidance validates API access tokens against
the tenant's public keys. [Custom claims guidance](https://support.auth0.com/center/s/article/adding-custom-claims-to-tokens), [FastAPI API authorization sample](https://developer.auth0.com/resources/code-samples/api/fastapi/basic-authorization).
