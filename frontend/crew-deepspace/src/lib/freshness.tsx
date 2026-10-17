/**
 * Online/offline state and "last updated" tracking. Every screen shows when its
 * data was last updated so old data is never mistaken for live data. The time
 * is kept in localStorage so it survives reloads and works with no signal.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

const KEY = 'cw:last-synced'
export const STALE_AFTER_MIN = 30

function readStored(): number | null {
  try {
    const v = localStorage.getItem(KEY)
    return v ? Number(v) : null
  } catch {
    return null
  }
}

interface FreshnessValue {
  online: boolean
  /** True once the whole app is saved on this phone and will open with no signal. */
  offlineReady: boolean
  lastSyncedAt: number | null
  now: number
  markFresh: (at?: number) => void
}

const Ctx = createContext<FreshnessValue | null>(null)

export function FreshnessProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  const [lastSyncedAt, setLast] = useState<number | null>(readStored)
  const [now, setNow] = useState(() => Date.now())
  const [offlineReady, setOfflineReady] = useState(false)

  useEffect(() => {
    // `ready` resolves once the offline helper has finished saving the app.
    if ('serviceWorker' in navigator) void navigator.serviceWorker.ready.then(() => setOfflineReady(true))
  }, [])

  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    const tick = setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
      clearInterval(tick)
    }
  }, [])

  const markFresh = useCallback((at = Date.now()) => {
    setLast(at)
    setNow(Date.now())
    try {
      localStorage.setItem(KEY, String(at))
    } catch {
      /* storage unavailable: freshness still works for this session */
    }
  }, [])

  const value = useMemo(() => ({ online, offlineReady, lastSyncedAt, now, markFresh }), [online, offlineReady, lastSyncedAt, now, markFresh])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useFreshness(): FreshnessValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useFreshness must be used inside <FreshnessProvider>')
  return v
}

/** "just now", "12 min ago", "3 h ago", or null when never synced. */
export function describeAge(at: number | null, now: number): string | null {
  if (at == null) return null
  const min = Math.max(0, Math.floor((now - at) / 60_000))
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`
}

export function isStale(at: number | null, now: number): boolean {
  return at == null || now - at > STALE_AFTER_MIN * 60_000
}
