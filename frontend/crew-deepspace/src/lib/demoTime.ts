/**
 * Demo mode: the sample JSON is stamped Oct 17, 2026 at 6:42 PM UTC, so a
 * countdown built on it would already be over. The first time the app runs we
 * remember "now" and shift every sample timestamp so the sample world starts
 * at that moment. Later reloads use the same shift, so the countdown keeps
 * running instead of restarting. "Reset demo" clears it.
 */
import type { Alert, SiteDetail } from '../contracts/types'

// Kept per site, so resetting or striking one site never changes another site's clock.
const OFFSET_KEY = 'cw:demo-offset'
const STRIKE_KEY = 'cw:demo-strike'
const offsetKey = (site: string) => `${OFFSET_KEY}:${site}`
const strikeKey = (site: string) => `${STRIKE_KEY}:${site}`
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const DAY = 86_400_000

export function demoOffsetMs(mockServerTime: string, sharedStart: number | undefined, site: string): number {
  // Live sync: every phone starts the sample world at the same shared moment, so their timers agree.
  if (sharedStart) {
    const offset = sharedStart - Date.parse(mockServerTime)
    try {
      localStorage.setItem(offsetKey(site), String(offset))
    } catch {
      /* ignore */
    }
    return offset
  }
  try {
    const stored = localStorage.getItem(offsetKey(site))
    if (stored) return Number(stored)
    const offset = Date.now() - Date.parse(mockServerTime)
    localStorage.setItem(offsetKey(site), String(offset))
    return offset
  } catch {
    return Date.now() - Date.parse(mockServerTime)
  }
}

/** Returns a copy of `value` with every timestamp and date moved by `offset`. */
export function shiftTimes<V>(value: V, offset: number): V {
  const days = Math.round(offset / DAY)
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (ISO_DATETIME.test(v)) return new Date(Date.parse(v) + offset).toISOString().replace(/\.\d{3}Z$/, 'Z')
      if (ISO_DATE.test(v)) return new Date(Date.parse(`${v}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10)
      return v
    }
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    return v
  }
  return walk(value) as V
}

export function readSimulatedStrike(site: string): number | null {
  try {
    const v = localStorage.getItem(strikeKey(site))
    return v ? Number(v) : null
  } catch {
    return null
  }
}

export function clearSimulatedStrike(site: string): void {
  try {
    localStorage.removeItem(strikeKey(site))
  } catch {
    /* ignore */
  }
}

export function recordSimulatedStrike(at: number, site: string): void {
  try {
    localStorage.setItem(strikeKey(site), String(at))
  } catch {
    /* ignore */
  }
}

/** Forget this site's saved demo values on this phone (clock, strike). Other sites and other people are untouched. */
export function resetDemoStorage(site: string, personalKeys: string[]): void {
  try {
    for (const k of [offsetKey(site), strikeKey(site), ...personalKeys]) localStorage.removeItem(k)
  } catch {
    /* ignore */
  }
}

/** Applies a "Simulate strike" press on top of the sample data. */
export function applySimulatedStrike(detail: SiteDetail, alerts: Alert[]): { detail: SiteDetail; alerts: Alert[] } {
  let at: number | null = null
  try {
    const v = localStorage.getItem(strikeKey(detail.site.site_id))
    at = v ? Number(v) : null
  } catch {
    at = null
  }
  if (at == null) return { detail, alerts }
  const strikeIso = new Date(at).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const until = new Date(at + 30 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const siteId = detail.site.site_id
  const nextDetail: SiteDetail = {
    ...detail,
    site: {
      ...detail.site,
      stop_work: {
        active: true,
        reason: 'lightning',
        last_strike_at: strikeIso,
        stop_work_until: until,
        strikes_last_30_min: Math.max(1, detail.site.stop_work.strikes_last_30_min) + 1,
        nearest_strike_miles: 3.1,
      },
    },
  }
  const simulated: Alert = {
    alert_id: `alt_sim_${at}`,
    site_id: siteId,
    type: 'stop_work_lightning',
    severity: 'stop_work',
    status: 'active',
    title: 'Stop work: lightning 3.1 miles away',
    message: 'Simulated strike for the demo. Stop outdoor work and shelter. The countdown restarts on every new strike.',
    started_at: strikeIso,
    stop_work_until: until,
    cleared_at: null,
    acknowledged_by: [],
    evidence: [{ source: 'demo-simulator', observed_at: strikeIso }],
    ledger_record_id: null,
    simulated: true,
  }
  const others = alerts.filter((a) => !(a.site_id === siteId && a.type === 'stop_work_lightning'))
  return { detail: nextDetail, alerts: [simulated, ...others] }
}
