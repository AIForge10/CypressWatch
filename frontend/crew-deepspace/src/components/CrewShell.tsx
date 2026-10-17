/**
 * Crew app shell: header (identity), freshness strip, and a bottom tab bar
 * sized for gloved thumbs. Color is never the only signal: every state pairs
 * an icon and words. Keep the data-testid hooks; the shipped tests use them.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { AuthOverlay } from 'deepspace'
import { AlertTriangle, Camera, Clock, FileText, LogIn, LogOut, Map, Wifi, WifiOff, Zap } from 'lucide-react'
import { cn } from '../lib/utils'
import { describeAge, isStale, useFreshness } from '../lib/freshness'
import { USE_MOCKS, useCrew } from '../lib/crewData'
import { signOutCrew, type Access } from '../lib/access'

const TABS = [
  { to: '/home', label: 'Site', Icon: Zap },
  { to: '/briefing', label: 'Briefing', Icon: FileText },
  { to: '/map', label: 'Map', Icon: Map },
  { to: '/report', label: 'Report', Icon: Camera },
] as const

export default function CrewShell({ children, access }: { children: ReactNode; access: Access }) {
  const mainRef = useRef<HTMLElement>(null)
  const { pathname } = useLocation()
  // Each tab opens at its top, so the countdown is never scrolled out of sight.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
  }, [pathname])
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <Header access={access} />
      <FreshnessStrip access={access} />
      <main ref={mainRef} className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      <TabBar />
    </div>
  )
}

function Header({ access }: { access: Access }) {
  const [showAuth, setShowAuth] = useState(false)
  return (
    <header
      data-testid="app-navigation"
      className="flex min-h-14 items-center justify-between gap-3 bg-primary px-4 pt-[env(safe-area-inset-top)] text-primary-foreground"
    >
      <span className="text-lg font-bold">CypressWatch</span>
      {access.allowed ? (
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0 text-right text-sm leading-tight">
            <div data-testid="nav-user-name" className="truncate font-bold">{access.name ?? access.email}</div>
            <div data-testid="nav-user-email" className="truncate opacity-90">{access.email}</div>
          </div>
          <button
            type="button"
            aria-label="Sign out"
            onClick={() => void signOutCrew(access.userId)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border-2 border-primary-foreground"
          >
            <LogOut className="h-5 w-5" aria-hidden />
          </button>
        </div>
      ) : (
        access.kind === 'signed-out' && (
          <button
            type="button"
            data-testid="nav-sign-in-button"
            onClick={() => setShowAuth(true)}
            className="flex h-11 items-center gap-2 rounded-lg bg-primary-foreground px-4 font-bold text-primary"
          >
            <LogIn className="h-5 w-5" aria-hidden /> Sign in
          </button>
        )
      )}
      {showAuth && <AuthOverlay providers={['google']} title="Sign in to CypressWatch" description="Your supervisor sees who is on site." onClose={() => setShowAuth(false)} />}
    </header>
  )
}

function FreshnessStrip({ access }: { access: Access }) {
  const { online, offlineReady, lastSyncedAt, now } = useFreshness()
  const age = describeAge(lastSyncedAt, now)
  const stale = isStale(lastSyncedAt, now)
  return (
    <div role="status" aria-live="polite" data-testid="freshness-strip" className="border-b-2 border-border bg-card px-4 py-2 text-sm font-bold">
      {USE_MOCKS && (
        <div data-testid="demo-banner" className="mb-1 flex items-center gap-2 rounded-md bg-[#fff0c2] px-2 py-1 text-[#0f1b14]">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          Demo data, not real conditions. Your site is a sample.
        </div>
      )}
      {access.kind === 'unverified' && (
        <div data-testid="unverified-banner" className="mb-1 flex items-center gap-2 rounded-md bg-[#fff0c2] px-2 py-1 text-[#0f1b14]">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          Sign-in not re-checked yet. It checks again when signal returns.
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className={cn('flex items-center gap-2', !online && 'text-destructive')}>
          {online ? <Wifi className="h-4 w-4" aria-hidden /> : <WifiOff className="h-4 w-4" aria-hidden />}
          {online ? (offlineReady ? 'Online. Saved for offline use' : 'Online. Saving for offline use...') : 'No signal: showing saved data'}
        </span>
        <span className={cn('flex items-center gap-2 rounded-md px-2 py-0.5', stale ? 'bg-warning text-foreground' : 'text-foreground')}>
          {stale ? <AlertTriangle className="h-4 w-4" aria-hidden /> : <Clock className="h-4 w-4" aria-hidden />}
          {age ? `Last updated ${age}${stale ? ' (old data)' : ''}` : 'Not updated yet'}
        </span>
      </div>
    </div>
  )
}

function TabBar() {
  const { queue } = useCrew()
  return (
    <nav aria-label="Crew app" className="grid grid-cols-4 border-t-2 border-border bg-card pb-[env(safe-area-inset-bottom)]">
      {TABS.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              'relative flex min-h-16 flex-col items-center justify-center gap-1 text-sm font-bold',
              isActive ? 'bg-primary text-primary-foreground' : 'text-foreground',
            )
          }
        >
          <Icon className="h-6 w-6" aria-hidden />
          {label}
          {to === '/report' && queue.length > 0 && (
            <span className="absolute right-3 top-2 min-w-6 rounded-full bg-warning px-1.5 text-center text-xs text-foreground">
              {queue.length}
              <span className="sr-only"> waiting to upload</span>
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
