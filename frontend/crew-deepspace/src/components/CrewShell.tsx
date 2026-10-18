/**
 * Crew app shell: header (identity), freshness strip, and a bottom tab bar
 * sized for gloved thumbs. Color is never the only signal: every state pairs
 * an icon and words. Keep the data-testid hooks; the shipped tests use them.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { AlertTriangle, Camera, Clock, FileText, LogIn, LogOut, Map, Sun, Users, Wifi, WifiOff, Zap } from 'lucide-react'
import { useSunlight } from '../lib/sunlight'
import { useAssignment } from '../lib/assignment'
import { cn } from '../lib/utils'
import { describeAge, isStale, useFreshness } from '../lib/freshness'
import { USE_MOCKS, useCrew } from '../lib/crewData'
import { signOutCrew, startGoogleSignIn, type Access } from '../lib/access'

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
      {/* Phone: tabs along the bottom. Tablet and up: menu down the left, content fills the rest. */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <main ref={mainRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</main>
        <TabBar />
      </div>
    </div>
  )
}

function Header({ access }: { access: Access }) {
  const [sun, toggleSun] = useSunlight()
  const sunButton = (
    <button
      type="button"
      data-testid="sunlight-toggle"
      aria-pressed={sun}
      aria-label="Sunlight mode"
      title="Sunlight mode: high contrast for bright light"
      onClick={toggleSun}
      className={cn('flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-bold', sun ? 'border-white bg-white text-brand-strong' : 'border-[#306b55] text-[#cfe5da] hover:bg-[#1d684f]')}
    >
      <Sun className="h-5 w-5" aria-hidden />
      <span className="hidden sm:inline">{sun ? 'Sunlight on' : 'Sunlight'}</span>
    </button>
  )
  return (
    <header
      data-testid="app-navigation"
      className="flex min-h-16 items-center justify-between gap-3 bg-brand-strong px-4 pt-[env(safe-area-inset-top)] text-white sm:px-6 lg:px-8"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[#d8f0e4] font-extrabold text-brand-strong" aria-hidden>CW</span>
        <div className="min-w-0 leading-tight">
          <div className="font-bold tracking-[-0.02em]">CypressWatch</div>
          <div className="text-xs text-[#abcbbd]">Crew</div>
        </div>
      </div>
      {access.allowed ? (
        <div className="flex min-w-0 items-center gap-3">
          {sunButton}
          <div className="min-w-0 text-right text-sm leading-tight">
            <div data-testid="nav-user-name" className="truncate font-bold">{access.name ?? access.email}</div>
            <div data-testid="nav-user-email" className="truncate text-[#abcbbd]">{access.email}</div>
          </div>
          <button
            type="button"
            aria-label="Sign out"
            onClick={() => void signOutCrew(access.userId)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[#306b55] text-[#cfe5da] hover:bg-[#1d684f]"
          >
            <LogOut className="h-5 w-5" aria-hidden />
          </button>
        </div>
      ) : (
        access.kind === 'signed-out' && (
          <button
            type="button"
            data-testid="nav-sign-in-button"
            onClick={startGoogleSignIn}
            className="flex h-11 items-center gap-2 rounded-lg bg-white px-4 font-bold text-brand-strong"
          >
            <LogIn className="h-5 w-5" aria-hidden /> Sign in
          </button>
        )
      )}
    </header>
  )
}

function FreshnessStrip({ access }: { access: Access }) {
  const { online, offlineReady, lastSyncedAt, now } = useFreshness()
  const age = describeAge(lastSyncedAt, now)
  const stale = isStale(lastSyncedAt, now)
  return (
    <div role="status" aria-live="polite" data-testid="freshness-strip" className="border-b border-border bg-card px-4 py-2 text-sm font-bold sm:px-6 lg:px-8">
      {USE_MOCKS && (
        <div data-testid="demo-banner" className="mb-1 flex items-center gap-2 rounded-lg border border-[#9a6700]/30 bg-caution px-2 py-1 text-foreground">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          Demo data, not real conditions. Your site is a sample.
        </div>
      )}
      {access.kind === 'unverified' && (
        <div data-testid="unverified-banner" className="mb-1 flex items-center gap-2 rounded-lg border border-[#9a6700]/30 bg-caution px-2 py-1 text-foreground">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          Sign-in not re-checked yet. It checks again when signal returns.
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className={cn('flex items-center gap-2', !online && 'text-destructive')}>
          {online ? <Wifi className="h-4 w-4" aria-hidden /> : <WifiOff className="h-4 w-4" aria-hidden />}
          {online ? (offlineReady ? 'Online. Saved for offline use' : 'Online. Saving for offline use...') : 'No signal: showing saved data'}
        </span>
        <span className={cn('flex items-center gap-2 rounded-md px-2 py-0.5', stale ? 'bg-caution text-foreground' : 'text-foreground')}>
          {stale ? <AlertTriangle className="h-4 w-4" aria-hidden /> : <Clock className="h-4 w-4" aria-hidden />}
          {age ? `Last updated ${age}${stale ? ' (old data)' : ''}` : 'Not updated yet'}
        </span>
      </div>
    </div>
  )
}

function TabBar() {
  const { queue } = useCrew()
  const { isAdmin } = useAssignment()
  const tabs = USE_MOCKS && isAdmin ? [...TABS, { to: '/team', label: 'Team', Icon: Users }] : TABS
  return (
    <nav
      aria-label="Crew app"
      style={{ ['--tabs' as string]: tabs.length }}
      className="grid grid-cols-[repeat(var(--tabs),minmax(0,1fr))] border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:order-first md:flex md:w-60 md:shrink-0 md:flex-col md:content-start md:gap-1 md:overflow-y-auto md:border-r md:border-t-0 md:p-3"
    >
      {tabs.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              'relative flex min-h-16 flex-col items-center justify-center gap-1 text-sm font-bold md:min-h-12 md:flex-row md:justify-start md:gap-3 md:rounded-lg md:px-4 md:text-base',
              isActive ? 'bg-primary text-primary-foreground' : 'text-foreground md:hover:bg-secondary',
            )
          }
        >
          <Icon className="h-6 w-6" aria-hidden />
          {label}
          {to === '/report' && queue.length > 0 && (
            <span className="absolute right-3 top-2 min-w-6 md:static md:ml-auto rounded-full border border-[#9a6700] bg-caution px-1.5 text-center text-xs text-foreground">
              {queue.length}
              <span className="sr-only"> waiting to upload</span>
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
