/**
 * Who is allowed into the crew app, and how we know.
 *
 * Crews sign in once with DeepSpace (Google). The check normally needs the
 * network, but this app must open with no signal, so there are four states:
 *   checking    asking DeepSpace who you are (waits at most WAIT_MS)
 *   signed-in   DeepSpace confirmed your session
 *   unverified  couldn't reach DeepSpace, but this phone remembers who signed in,
 *               so the saved app opens. Re-checked automatically when signal returns.
 *   signed-out  nobody signed in (or the session ended): show the sign-in screen
 *
 * "unverified" is a convenience for the screen only. It is NOT security: the
 * server must check the login token on every real request (see AUTH_NOTES.md).
 * We deliberately do not use the SDK's <AuthGate>: it redirects away whenever
 * the session can't be confirmed, which would eject people who lose signal.
 */
import { useEffect, useRef, useState } from 'react'
import { clearAuthToken, signOut, useAuth, useAuthUser, useSession } from 'deepspace'

export const WAIT_MS = 4000
const HINT_KEY = 'cw:auth-hint'

export interface AuthHint {
  userId: string
  name: string
  email: string
}

export type AccessKind = 'checking' | 'signed-in' | 'unverified' | 'signed-out'

export interface Access {
  kind: AccessKind
  /** True when the crew screens may be shown. */
  allowed: boolean
  userId: string | null
  name: string | null
  email: string | null
}

export function readHint(): AuthHint | null {
  try {
    const v = localStorage.getItem(HINT_KEY)
    return v ? (JSON.parse(v) as AuthHint) : null
  } catch {
    return null
  }
}

function writeHint(h: AuthHint) {
  try {
    localStorage.setItem(HINT_KEY, JSON.stringify(h))
  } catch {
    /* storage unavailable: sign-in still works while online */
  }
}

/** Per-person storage key, so two people sharing a phone never see each other's saved data. */
export function userKey(base: string, userId: string | null): string {
  return `${base}:${userId ?? 'anon'}`
}

/** Per-person, per-site storage key. A reset or move on one site never touches another site's saved data. */
export function siteKey(base: string, userId: string | null, siteId: string | null): string {
  return `${base}:${userId ?? 'anon'}:${siteId ?? 'none'}`
}

/** Forget this person on this phone. Waiting uploads stay queued and are tagged with their owner. */
export function forgetUser(userId: string | null) {
  try {
    localStorage.removeItem(HINT_KEY)
    // Every site's saved copy for this person (keys look like `base:userId` or `base:userId:siteId`).
    for (const base of ['cw:crew-cache', 'cw:acks', 'cw:local-reports', 'cw:reset-seen', 'cw:assignment']) {
      const mine = userKey(base, userId)
      for (const k of Object.keys(localStorage)) if (k === mine || k.startsWith(`${mine}:`)) localStorage.removeItem(k)
    }
  } catch {
    /* ignore */
  }
}

export async function signOutCrew(userId: string | null) {
  try {
    await signOut()
  } catch {
    /* no signal: we still clear this phone below */
  }
  clearAuthToken()
  forgetUser(userId)
  location.assign('/home')
}

export function useCrewAccess(online: boolean): Access {
  const { isLoaded, isSignedIn, userId } = useAuth()
  const { user } = useAuthUser()
  const session = useSession()
  const hint = useRef<AuthHint | null>(readHint()).current
  const [waited, setWaited] = useState(false)

  useEffect(() => {
    if (isLoaded) return
    const id = setTimeout(() => setWaited(true), WAIT_MS)
    return () => clearTimeout(id)
  }, [isLoaded])

  const email = user?.primaryEmailAddress?.emailAddress ?? null
  const name = user?.fullName || (email ? email.split('@')[0] : null)

  // Remember who is signed in, so the app can open offline next time.
  useEffect(() => {
    if (isLoaded && isSignedIn && userId) writeHint({ userId, name: name ?? '', email: email ?? '' })
  }, [isLoaded, isSignedIn, userId, name, email])

  // Signal is back and we were running on memory: ask DeepSpace again.
  const refetch = session.refetch
  useEffect(() => {
    if (online && !isSignedIn && hint) void refetch()
  }, [online, isSignedIn, hint, refetch])

  if (isLoaded && isSignedIn && userId) return { kind: 'signed-in', allowed: true, userId, name, email }

  // A failed check (offline, or an error) is not the same as "signed out".
  const couldNotCheck = (!isLoaded && waited) || (isLoaded && (!online || !!session.error))
  if (hint && couldNotCheck) return { kind: 'unverified', allowed: true, userId: hint.userId, name: hint.name || null, email: hint.email || null }

  if (!isLoaded && !waited) return { kind: 'checking', allowed: false, userId: null, name: null, email: null }
  return { kind: 'signed-out', allowed: false, userId: null, name: null, email: null }
}

/**
 * Starts Google sign-in. Same address the SDK's own sign-in box uses, but without that box,
 * which also shows an email/password form that can't create accounts.
 */
export function startGoogleSignIn(): void {
  window.location.href = '/api/auth/social-redirect?provider=google'
}
