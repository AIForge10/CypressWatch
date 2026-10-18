/**
 * CypressWatch Post-Login Action: puts the CypressWatch role, site_ids and MFA time on the ID token
 * (supervisor UI navigation) and the access token (API enforcement). See docs/auth0-api.md.
 *
 * Install: Auth0 Dashboard -> Actions -> Library -> open the CypressWatch claims Action (or Create Action,
 * trigger "Login / Post Login"), replace its code with this file, add the secret below, Deploy, and make
 * sure it is in Actions -> Triggers -> post-login, after any Action that runs an MFA challenge.
 *
 * Secret (Action -> Settings -> Secrets):
 *   TEAM_SUPERVISOR_EMAILS   comma-separated team emails, e.g. "a@gmail.com,b@ufl.edu"
 *
 * Where the role comes from (first match wins):
 *   1. app_metadata.role / app_metadata.site_ids  - set by an admin on one user (most specific)
 *   2. Auth0 Roles (User Management -> Roles) named supervisor, crew or owner
 *   3. TEAM_SUPERVISOR_EMAILS with a verified email -> supervisor on every site ("*")
 * Nothing matches -> no role claim: the app shows "Access restricted" and the API answers 403.
 * Teammates who sign up with email and password must verify their email before the allowlist applies.
 */
exports.onExecutePostLogin = async (event, api) => {
  const namespace = 'https://cypresswatch.app/';
  const VALID_ROLES = ['supervisor', 'crew', 'owner'];
  const normalize = (value) => {
    const role = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    return role === 'project_owner' ? 'owner' : role;
  };

  const meta = event.user.app_metadata || {};
  const email = String(event.user.email || '').trim().toLowerCase();
  const team = String(event.secrets.TEAM_SUPERVISOR_EMAILS || '')
    .split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
  const onTeam = event.user.email_verified === true && email !== '' && team.includes(email);

  const metaRole = normalize(meta.role);
  const rbacRole = (event.authorization?.roles || []).map(normalize).find((role) => VALID_ROLES.includes(role));
  const role = VALID_ROLES.includes(metaRole) ? metaRole : rbacRole || (onTeam ? 'supervisor' : undefined);

  const metaSites = Array.isArray(meta.site_ids) ? meta.site_ids.filter((id) => typeof id === 'string' && id) : [];
  const siteIds = metaSites.length ? metaSites : onTeam ? ['*'] : [];

  const claims = { [`${namespace}site_ids`]: siteIds };
  if (role) claims[`${namespace}role`] = role;

  // This value comes from Auth0's recorded MFA method timestamp, not the browser.
  const mfa = event.authentication?.methods?.find((method) => method.name === 'mfa');
  if (mfa?.timestamp) claims[`${namespace}mfa_at`] = Math.floor(Date.parse(mfa.timestamp) / 1000);

  for (const [claim, value] of Object.entries(claims)) {
    api.idToken.setCustomClaim(claim, value);
    api.accessToken.setCustomClaim(claim, value);
  }
};
