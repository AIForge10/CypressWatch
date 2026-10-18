import { Auth0Provider, useAuth0, type User as Auth0User } from '@auth0/auth0-react';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';

export type Role = 'supervisor' | 'crew' | 'owner';
export type Permission = 'sites:read' | 'briefings:read' | 'reports:write' | 'ledger:read';
export type MockUser = { id: string; name: string; email: string; role: Role | null; assignedSiteIds: string[]; roleClaim?: unknown };

const demoUsers: Record<Role, MockUser> = {
  supervisor: { id: 'demo-supervisor', name: 'Jordan Lee', email: 'supervisor@example.com', role: 'supervisor', assignedSiteIds: ['site-01', 'site-02'] },
  crew: { id: 'demo-crew', name: 'Sam Rivera', email: 'crew@example.com', role: 'crew', assignedSiteIds: ['site-01'] },
  owner: { id: 'demo-owner', name: 'Taylor Morgan', email: 'owner@example.com', role: 'owner', assignedSiteIds: ['site-01', 'site-02'] },
};

type AuthContextValue = {
  user: MockUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isMockAuth: boolean;
  login: (role?: Role) => void;
  logout: () => void;
  getAccessToken: (options?: { forceRefresh?: boolean }) => Promise<string | null>;
  hasPermission: (permission: Permission) => boolean;
  requestStepUp: (returnTo: string) => Promise<void>;
  hasFreshMfa: (requestedAt: number) => boolean;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const storageKey = 'cypresswatch-demo-role';
const auth0Domain = import.meta.env.VITE_AUTH0_DOMAIN;
const auth0ClientId = import.meta.env.VITE_AUTH0_CLIENT_ID;
const auth0Audience = import.meta.env.VITE_AUTH0_AUDIENCE;
const auth0RoleClaim = import.meta.env.VITE_AUTH0_ROLE_CLAIM ?? 'https://cypresswatch.app/role';
const auth0SiteIdsClaim = import.meta.env.VITE_AUTH0_SITE_IDS_CLAIM ?? 'https://cypresswatch.app/site_ids';
const auth0MfaAtClaim = import.meta.env.VITE_AUTH0_MFA_AT_CLAIM ?? 'https://cypresswatch.app/mfa_at';
const auth0Configured = Boolean(auth0Domain && auth0ClientId);
const mfaAcr = 'http://schemas.openid.net/pape/policies/2007/06/multi-factor';

function hasFreshMfaClaim(user: Auth0User | undefined, requestedAt: number): boolean {
  if (!user || !Number.isFinite(requestedAt)) return false;
  const claims = user as Auth0User & Record<string, unknown>;
  const mfaAt = claims[auth0MfaAtClaim];
  // The Post-Login Action copies Auth0's completed-MFA timestamp into this
  // signed ID token. The API independently checks the access-token copy.
  return typeof mfaAt === 'number' && mfaAt * 1000 >= requestedAt - 5000 && Date.now() - mfaAt * 1000 < 5 * 60 * 1000;
}

function roleFromClaim(value: unknown): Role | null {
  if (value === 'supervisor' || value === 'crew' || value === 'owner') return value;
  if (value === 'project_owner') return 'owner';
  return null;
}

function auth0UserToAppUser(user: Auth0User | undefined): MockUser | null {
  if (!user) return null;
  const claims = user as Auth0User & Record<string, unknown>;
  const role = roleFromClaim(claims[auth0RoleClaim] ?? claims.role);
  const siteIds = claims[auth0SiteIdsClaim];
  const assignedSiteIds = Array.isArray(siteIds) ? siteIds.filter((id): id is string => typeof id === 'string') : [];
  return { id: user.sub ?? 'auth0-user', name: user.name ?? user.nickname ?? user.email ?? 'CypressWatch user', email: user.email ?? '', role, assignedSiteIds, roleClaim: claims[auth0RoleClaim] ?? claims.role };
}

function permissionsFor(role: Role | null | undefined, permission: Permission) {
  if (!role) return false;
  if (permission === 'reports:write') return role === 'crew';
  if (permission === 'ledger:read') return role === 'supervisor' || role === 'owner';
  return true;
}

function MockAuthProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role | null>(() => {
    const savedRole = localStorage.getItem(storageKey);
    return savedRole === 'supervisor' || savedRole === 'crew' || savedRole === 'owner' ? savedRole : null;
  });
  const user = role ? demoUsers[role] : null;
  const value = useMemo<AuthContextValue>(() => ({
    user, isAuthenticated: Boolean(user), isLoading: false, isMockAuth: true,
    login: (nextRole = 'supervisor') => { localStorage.setItem(storageKey, nextRole); setRole(nextRole); },
    logout: () => { localStorage.removeItem(storageKey); setRole(null); },
    getAccessToken: async () => user ? 'mock-access-token' : null,
    hasPermission: (permission) => permissionsFor(user?.role, permission),
    requestStepUp: async () => {},
    hasFreshMfa: () => false,
  }), [user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function Auth0AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  return <Auth0Provider domain={auth0Domain} clientId={auth0ClientId} authorizationParams={{ redirect_uri: window.location.origin, ...(auth0Audience ? { audience: auth0Audience } : {}) }} onRedirectCallback={(appState) => navigate(appState?.returnTo ?? '/app')}>
    <Auth0ContextBridge>{children}</Auth0ContextBridge>
  </Auth0Provider>;
}

function Auth0ContextBridge({ children }: { children: ReactNode }) {
  const { user: auth0User, isAuthenticated, isLoading, loginWithRedirect, logout: auth0Logout, getAccessTokenSilently } = useAuth0();
  const user = auth0UserToAppUser(auth0User);
  const value = useMemo<AuthContextValue>(() => ({
    user, isAuthenticated, isLoading, isMockAuth: false,
    login: () => { void loginWithRedirect({ appState: { returnTo: '/app' } }); },
    logout: () => { void auth0Logout({ logoutParams: { returnTo: window.location.origin } }); },
    getAccessToken: async (options) => {
      try {
        return (await getAccessTokenSilently(options?.forceRefresh ? { cacheMode: 'off' } : undefined)) ?? null;
      } catch {
        return null;
      }
    },
    hasPermission: (permission) => permissionsFor(user?.role, permission),
    requestStepUp: (returnTo) => loginWithRedirect({
      appState: { returnTo: `${returnTo}?step_up=returned` },
      authorizationParams: { acr_values: mfaAcr, max_age: 0, prompt: 'login', ...(auth0Audience ? { audience: auth0Audience } : {}) },
    }),
    hasFreshMfa: (requestedAt) => hasFreshMfaClaim(auth0User, requestedAt),
  }), [auth0User, getAccessTokenSilently, isAuthenticated, isLoading, loginWithRedirect, auth0Logout, user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return auth0Configured ? <Auth0AuthProvider>{children}</Auth0AuthProvider> : <MockAuthProvider>{children}</MockAuthProvider>;
}

export function useAuth() { const context = useContext(AuthContext); if (!context) throw new Error('useAuth must be used inside AuthProvider'); return context; }
export function RequireAuth() { const { isAuthenticated, isLoading } = useAuth(); const location = useLocation(); if (isLoading) return <div className="cw-auth-loading">Checking authentication…</div>; return isAuthenticated ? <Outlet /> : <Navigate to="/login" state={{ from: location }} replace />; }
export function RequireRole({ role }: { role: Role }) { const { user, isLoading } = useAuth(); if (isLoading) return <div className="cw-auth-loading">Checking access…</div>; return user?.role === role ? <Outlet /> : <Navigate to="/app" replace />; }
// Shown when sign-in worked but the ID token carries no usable role. Says exactly what an Auth0 admin must
// change, and shows the user id so the admin edits the right account (Google and email/password sign-ins
// with the same address are separate Auth0 users).
export function AccessDenied() {
  const { user, logout } = useAuth();
  const [copied, setCopied] = useState(false);
  const connection = user?.id.split('|')[0];
  const signedInWith = connection === 'google-oauth2' ? 'Google' : connection === 'auth0' ? 'email and password' : connection;
  const hasUnknownRole = user?.roleClaim !== undefined && user?.roleClaim !== null && user?.roleClaim !== '';
  const fix = '{ "role": "supervisor", "site_ids": ["*"] }';
  const copy = () => { void navigator.clipboard?.writeText(fix).then(() => setCopied(true)).catch(() => setCopied(false)); };
  return <div className="cw-auth-loading"><div className="cw-access-denied">
    <p className="cw-eyebrow">Signed in · no CypressWatch role</p>
    <h1>Access restricted</h1>
    <p>You are signed in as <strong>{user?.email || user?.name}</strong>{signedInWith ? <> with {signedInWith}</> : null}, but your account {hasUnknownRole ? <>has an unrecognized role (<code>{String(user?.roleClaim)}</code>)</> : 'has no CypressWatch role yet'}.</p>
    <div className="cw-access-denied-steps">
      <p><strong>Ask a CypressWatch admin to:</strong></p>
      <ol>
        <li>Add your email to the team allowlist, <em>or</em> open your user in Auth0 → User Management → Users.</li>
        <li>Set <strong>app_metadata</strong> (not user_metadata) to:</li>
      </ol>
      <pre>{fix}</pre>
      <p className="cw-access-denied-id">Auth0 user id: <code>{user?.id}</code></p>
    </div>
    <div className="cw-access-denied-actions">
      <button className="cw-button cw-button-secondary" type="button" onClick={copy}>{copied ? 'Copied' : 'Copy app_metadata'}</button>
      <button className="cw-button cw-button-primary" type="button" onClick={logout}>Sign out and try again</button>
    </div>
    <p className="cw-access-denied-note">Roles are read when you sign in, so sign out and back in after the change.</p>
  </div></div>;
}
