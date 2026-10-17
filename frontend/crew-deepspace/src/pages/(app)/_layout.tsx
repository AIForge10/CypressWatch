/**
 * Dynamic app boundary — the auth + realtime data layer.
 *
 * `(app)` is a Generouted route group: the parentheses mean it does NOT appear
 * in the URL, so (app)/home.tsx is served at /home. Every page under this
 * folder is wrapped in the DeepSpace providers below, so it may call `useAuth`,
 * `useQuery`, `useMutations`, presence/Yjs hooks, etc.
 *
 * Pages OUTSIDE this folder (top level of src/pages/) get none of this — they
 * render as static pages with no auth fetch and no records WebSocket. Move a
 * page in or out of (app)/ to flip it between dynamic and static. Require
 * sign-in on top of the data layer by nesting under (app)/(protected)/.
 *
 * This is where the app chrome (Navigation) lives, so static pages can present
 * their own layout without inheriting it.
 */

import { Suspense, useEffect, useState, type ReactNode } from 'react'
import { Outlet } from 'react-router-dom'
import { DeepSpaceAuthProvider, useAuthStatus } from 'deepspace'
import { RecordProvider, RecordScope } from 'deepspace'
import CrewShell from '../../components/CrewShell'
import { FreshnessProvider, useFreshness } from '../../lib/freshness'
import { CrewDataProvider } from '../../lib/crewData'
import { useCrewAccess } from '../../lib/access'
import { SignedOutPanel } from '../../components/SignedOutPanel'
import { useToast } from '@/components/ui'
import { APP_NAME, SCOPE_ID } from '../../constants'
import { schemas } from '../../schemas'

/** Sign-in gate + data + shell. Inside the auth and freshness providers. */
function CrewApp() {
  const { online } = useFreshness()
  const access = useCrewAccess(online)
  return (
    // Keyed by person: a different person on this phone gets fresh state.
    <CrewDataProvider key={access.userId ?? 'anon'} enabled={access.allowed} identity={{ userId: access.userId, name: access.name }}>
      <CrewShell access={access}>
        {access.allowed ? (
          <Suspense fallback={<div className="flex h-full items-center justify-center text-muted-foreground">Loading...</div>}>
            <Outlet />
          </Suspense>
        ) : (
          <SignedOutPanel checking={access.kind === 'checking'} online={online} />
        )}
      </CrewShell>
    </CrewDataProvider>
  )
}

export default function AppLayout() {
  return (
    <DeepSpaceAuthProvider>
      {/* The prerendered landing owns the document <title> and React drops it
          when <Seo> unmounts, so every route without <Seo> sets its own. */}
      <title>{APP_NAME}</title>
      <AuthBoot>
        <FreshnessProvider>
          <CrewApp />
        </FreshnessProvider>
      </AuthBoot>
    </DeepSpaceAuthProvider>
  )
}

/**
 * Waits for auth to resolve, then mounts the data layer. Distinct from the SDK's `AuthGate`.
 *
 * While the initial session check is in flight, renders a fixed full-viewport
 * panel in the theme background — visually identical to the pre-JS page
 * (index.html primes <html> with the same color), so a cold load shows a
 * steady theme-colored screen until the shell appears. No spinner text: the
 * check is one round-trip, and in-flow placeholders read as a layout jump.
 */
function AuthBoot({ children }: { children: ReactNode }) {
  const { isLoaded, userId } = useAuthStatus()
  // On weak signal the sign-in check can stall. Don't leave crews on a blank screen:
  // after a short wait open the app anyway; the gate inside decides what to show.
  const [waited, setWaited] = useState(false)
  useEffect(() => {
    if (isLoaded) return
    const id = setTimeout(() => setWaited(true), 1500)
    return () => clearTimeout(id)
  }, [isLoaded])
  // Record writes (`create`/`put`/`remove`) are fire-and-forget — they resolve
  // before the server answers, so a denied or invalid write only surfaces
  // through onWriteError. Route rejections to toasts so they're never a
  // silent no-op. Keep this wiring when customizing the layout.
  const { error, warning } = useToast()

  if (!isLoaded && !waited) {
    return <div aria-busy="true" className="fixed inset-0 bg-background" />
  }

  // The SDK's RecordProvider renders nothing until the session check finishes.
  // The crew app doesn't need live records yet (mock mode, offline-first), so on a stalled
  // check we show the app without it. It mounts as soon as the check completes.
  if (!isLoaded) return <>{children}</>

  return (
    <RecordProvider
      key={userId ?? 'anon'}
      allowAnonymous
      onWriteError={(e) =>
        e.kind === 'permission' ? warning(e.title, e.detail) : error(e.title, e.detail)
      }
    >
      <RecordScope roomId={SCOPE_ID} schemas={schemas}>
        {children}
      </RecordScope>
    </RecordProvider>
  )
}
