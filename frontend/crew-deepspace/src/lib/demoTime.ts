/**
 * Demo mode: the sample JSON is stamped Oct 17, 2026 at 6:42 PM UTC, so a
 * countdown built on it would already be over. The first time the app runs we
 * remember "now" and shift every sample timestamp so the sample world starts
 * at that moment. Later reloads use the same shift, so the countdown keeps
 * running instead of restarting. "Reset demo" clears it.
 */
import type { Alert, SiteDetail } from '../contracts/types'

const OFFSET_KEY = 'cw:demo-offset'
const STRIKE_KEY = 'cw:demo-strike'
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const DAY = 86_400_000

export function demoOffsetMs(mockServerTime: string): number {
  try {
    const stored = localStorage.getItem(OFFSET_KEY)
    if (stored) return Number(stored)
    const offset = Date.now() - Date.parse(mockServerTime)
    localStorage.setItem(OFFSET_KEY, String(offset))
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

export function recordSimulatedStrike(at: number): void {
  try {
    localStorage.setItem(STRIKE_KEY, String(at))
  } catch {
    /* ignore */
  }
}

export function resetDemoStorage(): void {
  try {
    // Every saved demo value (per-person cache, confirmations, reports, clocks), but not who is signed in.
    for (const k of Object.keys(localStorage)) if (k.startsWith('cw:') && k !== 'cw:auth-hint') localStorage.removeItem(k)
  } catch {
    /* ignore */
  }
}

/** Applies a "Simulate strike" press on top of the sample data. */
export function applySimulatedStrike(detail: SiteDetail, alerts: Alert[]): { detail: SiteDetail; alerts: Alert[] } {
  let at: number | null = null
  try {
    const v = localStorage.getItem(STRIKE_KEY)
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
