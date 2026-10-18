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

Add this claim-setting Action to the **Post Login** flow, after any Action that performs an MFA
challenge. It puts the same authorization claims in both
the ID token (for supervisor UI navigation) and the access token (for API enforcement).
Roles must be one of `supervisor`, `crew`, or `owner`; `site_ids` must contain IDs from
`backend/data/sites/sites.json` (for example `site_56407`), or `"*"` for an account
deliberately authorized for every site. The old UI demo IDs such as `site-01` are
not backend site IDs and will return no assigned sites. Store these values in
controlled `app_metadata`, not editable `user_metadata`.

A successful login with `200 OK` from `/api/sites/summary` but an empty `sites`
array means the signed token has no site IDs matching the backend catalog.
Check both the user's `app_metadata.site_ids` and the Post-Login Action's
access-token claim; ID-token-only claims are insufficient for API access.

```js
exports.onExecutePostLogin = async (event, api) => {
  const namespace = 'https://cypresswatch.app/';
  const role = event.user.app_metadata?.role;
  const siteIds = event.user.app_metadata?.site_ids;
  const claims = {
    [`${namespace}role`]: role,
    [`${namespace}site_ids`]: Array.isArray(siteIds) ? siteIds : [],
  };

  for (const [claim, value] of Object.entries(claims)) {
    api.idToken.setCustomClaim(claim, value);
    api.accessToken.setCustomClaim(claim, value);
  }

  // This value comes from Auth0's recorded MFA method timestamp, not the browser.
  const mfa = event.authentication?.methods?.find((method) => method.name === 'mfa');
  if (mfa?.timestamp) {
    const mfaAt = Math.floor(Date.parse(mfa.timestamp) / 1000);
    api.idToken.setCustomClaim(`${namespace}mfa_at`, mfaAt);
    api.accessToken.setCustomClaim(`${namespace}mfa_at`, mfaAt);
  }
};
```

The API allows a stop-work override only for a `supervisor` assigned to the alert's site.
It additionally requires a valid signed `mfa_at` timestamp no older than five minutes. The UI requests
reauthentication with `max_age=0`; the API is still the final authority and fails closed when a required
claim is absent or stale.

For every-login or step-up MFA, configure the Auth0 Post-Login MFA policy/Action so the
completion is available in `event.authentication.methods` before this claim-setting Action runs.
Do not change the API to accept a browser header as a shortcut. Auth0 supports namespaced custom claims on both ID and access
tokens through Post-Login Actions, and its FastAPI guidance validates API access tokens against
the tenant's public keys. [Custom claims guidance](https://support.auth0.com/center/s/article/adding-custom-claims-to-tokens), [FastAPI API authorization sample](https://developer.auth0.com/resources/code-samples/api/fastapi/basic-authorization).
