/**
 * Crew app shell: header (identity), freshness strip, and a bottom tab bar
 * sized for gloved thumbs. Color is never the only signal: every state pairs
 * an icon and words. Keep the data-testid hooks; the shipped tests use them.
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { AlertTriangle, Camera, Clock, FileText, Languages, LogIn, LogOut, Map, Sun, Users, Wifi, WifiOff, Zap } from 'lucide-react'
import { useSunlight } from '../lib/sunlight'
import { useLanguage } from '../lib/language'
import { useT, type TKey } from '../lib/i18n'
import DisplayMenu from './DisplayMenu'
import { useAssignment } from '../lib/assignment'
import { cn } from '../lib/utils'
import { describeAge, isStale, useFreshness } from '../lib/freshness'
import { USE_MOCKS, useCrew } from '../lib/crewData'
import { signOutCrew, startGoogleSignIn, type Access } from '../lib/access'

const TABS: { to: string; label: TKey; Icon: typeof Zap }[] = [
  { to: '/home', label: 'nav.site', Icon: Zap },
  { to: '/briefing', label: 'nav.briefing', Icon: FileText },
  { to: '/map', label: 'nav.map', Icon: Map },
  { to: '/report', label: 'nav.report', Icon: Camera },
]

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
  const { t } = useT()
  const [sun, toggleSun] = useSunlight()
  const [lang, toggleLang] = useLanguage()
  const sunButton = (
    <button
      type="button"
      data-testid="sunlight-toggle"
      aria-pressed={sun}
      aria-label={t('sun.label')}
      title={t('sun.title')}
      onClick={toggleSun}
      className={cn('flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-bold', sun ? 'border-white bg-white text-brand-strong' : 'border-[#5a5a55] text-[#e3eeee] hover:bg-[#4a4a45]')}
    >
      <Sun className="h-5 w-5" aria-hidden />
      <span className="hidden sm:inline">{sun ? t('sun.on') : t('sun.off')}</span>
    </button>
  )
  const langButton = (
    <button
      type="button"
      data-testid="lang-toggle"
      aria-label={t('lang.label')}
      title={t('lang.label')}
      lang={lang === 'es' ? 'en' : 'es'}
      onClick={toggleLang}
      className="flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-[#5a5a55] px-2 text-sm font-bold text-[#e3eeee] hover:bg-[#4a4a45] sm:px-3"
    >
      <Languages className="hidden h-5 w-5 sm:block" aria-hidden />
      <span className="sm:hidden" aria-hidden>{t('lang.short.toEs')}</span>
      <span className="hidden sm:inline" aria-hidden>{t('lang.name.toEs')}</span>
    </button>
  )
  return (
    <header
      data-testid="app-navigation"
      className="relative z-50 flex min-h-16 items-center justify-between gap-3 bg-brand-strong px-4 pt-[env(safe-area-inset-top)] text-white sm:px-6 lg:px-8"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-brand-soft font-extrabold text-brand-strong" aria-hidden>CW</span>
        <div className="hidden min-w-0 leading-tight min-[440px]:block">
          <div className="truncate font-bold tracking-[-0.02em]">CypressWatch</div>
          <div className="text-xs text-[#c5d9db]">{t('brand.crew')}</div>
        </div>
      </div>
      {access.allowed ? (
        <div className="flex shrink-0 items-center justify-end gap-2 sm:gap-3">
          {sunButton}
          {langButton}
          <DisplayMenu />
          <div className="hidden min-w-0 max-w-48 text-right text-sm leading-tight sm:block">
            <div data-testid="nav-user-name" className="truncate font-bold">{access.name ?? access.email}</div>
            <div data-testid="nav-user-email" className="truncate text-[#c5d9db]">{access.email}</div>
          </div>
          <button
            type="button"
            data-testid="sign-out"
            aria-label={t('auth.signOut')}
            title={`${t('auth.signOut')}: ${access.name ?? access.email ?? ''}`}
            onClick={() => void signOutCrew(access.userId)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[#5a5a55] text-[#e3eeee] hover:bg-[#4a4a45]"
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
            <LogIn className="h-5 w-5" aria-hidden /> {t('auth.signIn')}
          </button>
        )
      )}
    </header>
  )
}

function FreshnessStrip({ access }: { access: Access }) {
  const { t, lang } = useT()
  const { online, offlineReady, lastSyncedAt, now } = useFreshness()
  const age = describeAge(lastSyncedAt, now, lang)
  const stale = isStale(lastSyncedAt, now)
  return (
    <div role="status" aria-live="polite" data-testid="freshness-strip" className="border-b border-border bg-card px-4 py-2 text-sm font-bold sm:px-6 lg:px-8">
      {USE_MOCKS && (
        <div data-testid="demo-banner" className="mb-1 flex items-center gap-2 rounded-lg border border-[#9a6700]/30 bg-caution px-2 py-1 text-foreground">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          {t('banner.demo')}
        </div>
      )}
      {access.kind === 'unverified' && (
        <div data-testid="unverified-banner" className="mb-1 flex items-center gap-2 rounded-lg border border-[#9a6700]/30 bg-caution px-2 py-1 text-foreground">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          {t('banner.unverified')}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className={cn('flex items-center gap-2', !online && 'text-destructive')}>
          {online ? <Wifi className="h-4 w-4" aria-hidden /> : <WifiOff className="h-4 w-4" aria-hidden />}
          {online ? (offlineReady ? t('net.onlineReady') : t('net.onlineSaving')) : t('net.offline')}
        </span>
        <span className={cn('flex items-center gap-2 rounded-md px-2 py-0.5', stale ? 'bg-caution text-foreground' : 'text-foreground')}>
          {stale ? <AlertTriangle className="h-4 w-4" aria-hidden /> : <Clock className="h-4 w-4" aria-hidden />}
          {age ? `${t('fresh.updated', { age })}${stale ? t('fresh.old') : ''}` : t('fresh.never')}
        </span>
      </div>
    </div>
  )
}

function TabBar() {
  const { t } = useT()
  const { queue } = useCrew()
  const { isAdmin } = useAssignment()
  const tabs = USE_MOCKS && isAdmin ? [...TABS, { to: '/team', label: 'nav.team' as TKey, Icon: Users }] : TABS
  return (
    <nav
      aria-label={t('nav.label')}
      style={{ ['--tabs' as string]: tabs.length }}
      className="grid grid-cols-[repeat(var(--tabs),minmax(0,1fr))] border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:order-first md:flex md:w-60 md:shrink-0 md:flex-col md:content-start md:gap-1 md:overflow-y-auto md:border-r md:border-t-0 md:p-3"
    >
      {tabs.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              'relative flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 text-sm font-bold md:min-h-12 md:flex-row md:justify-start md:gap-3 md:rounded-lg md:px-4 md:text-base',
              isActive ? 'bg-primary text-primary-foreground' : 'text-foreground md:hover:bg-secondary',
            )
          }
        >
          <Icon className="h-6 w-6 shrink-0" aria-hidden />
          <span className="max-w-full truncate">{t(label)}</span>
          {to === '/report' && queue.length > 0 && (
            <span className="absolute right-3 top-2 min-w-6 md:static md:ml-auto rounded-full border border-[#9a6700] bg-caution px-1.5 text-center text-xs text-foreground">
              {queue.length}
              <span className="sr-only">{t('queue.waiting')}</span>
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
