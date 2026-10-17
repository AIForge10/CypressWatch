import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

export type Role = 'supervisor' | 'crew' | 'owner';
export type Permission = 'sites:read' | 'briefings:read' | 'reports:write' | 'ledger:read';
export type MockUser = { id: string; name: string; email: string; role: Role; assignedSiteIds: string[] };

const demoUsers: Record<Role, MockUser> = {
  supervisor: { id: 'demo-supervisor', name: 'Jordan Lee', email: 'supervisor@example.com', role: 'supervisor', assignedSiteIds: ['site-01', 'site-02'] },
  crew: { id: 'demo-crew', name: 'Sam Rivera', email: 'crew@example.com', role: 'crew', assignedSiteIds: ['site-01'] },
  owner: { id: 'demo-owner', name: 'Taylor Morgan', email: 'owner@example.com', role: 'owner', assignedSiteIds: ['site-01', 'site-02'] },
};

type AuthContextValue = {
  user: MockUser | null;
  isAuthenticated: boolean;
  login: (role?: Role) => void;
  logout: () => void;
  getAccessToken: () => Promise<string | null>;
  hasPermission: (permission: Permission) => boolean;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const storageKey = 'cypresswatch-demo-role';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role | null>(() => {
    const savedRole = localStorage.getItem(storageKey);
    return savedRole === 'supervisor' || savedRole === 'crew' || savedRole === 'owner' ? savedRole : null;
  });
  const user = role ? demoUsers[role] : null;
  const value = useMemo<AuthContextValue>(() => ({
    user,
    isAuthenticated: Boolean(user),
    login: (nextRole = 'supervisor') => { localStorage.setItem(storageKey, nextRole); setRole(nextRole); },
    logout: () => { localStorage.removeItem(storageKey); setRole(null); },
    getAccessToken: async () => user ? 'mock-access-token' : null,
    hasPermission: (permission) => {
      if (!user) return false;
      if (permission === 'reports:write') return user.role === 'crew';
      return true;
    },
  }), [user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

export function RequireAuth() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" state={{ from: location }} replace />;
}

export function RequireRole({ role }: { role: Role }) {
  const { user } = useAuth();
  return user?.role === role ? <Outlet /> : <Navigate to="/app" replace />;
}
