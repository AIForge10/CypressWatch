/**
 * Crew data layer. One place that:
 *  - loads the crew member's site, alerts, briefing and reports through the
 *    shared API client (contracts/api.ts), using sample data when
 *    VITE_USE_MOCKS=true;
 *  - saves the last good copy on the phone, and falls back to it with no signal;
 *  - queues actions taken offline (hazard reports, acknowledgments) and replays
 *    them in order when signal returns.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getAuthToken } from 'deepspace'
import { api, secondsLeft, setTokenGetter } from '../contracts/api'
import type { Alert, ApiError, Briefing, Me, Report, ReportRequest, SiteDetail } from '../contracts/types'
import meCrewMock from '../contracts/mocks/me_crew.json'
import { userKey } from './access'
import { applySimulatedStrike, demoOffsetMs, recordSimulatedStrike, resetDemoStorage, shiftTimes } from './demoTime'
import { useFreshness } from './freshness'
import { bumpAttempts, clearQueue, enqueue, getPhoto, listQueue, removeItem, type QueueItem } from './queue'

export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true'

// Real mode: every API call carries the signed-in person's DeepSpace login token.
// (The backend must verify DeepSpace-issued tokens; see AUTH_NOTES.md.)
setTokenGetter(async () => (await getAuthToken()) ?? '')


interface Snapshot {
  savedAt: number
  me: Me
  detail: SiteDetail
  alerts: Alert[]
  briefing: Briefing | null
  reports: Report[]
  /** server_time minus the phone's clock, so the countdown is right even if the phone clock is off. */
  serverOffsetMs: number
}

function readJson<V>(key: string, fallback: V): V {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as V) : fallback
  } catch {
    return fallback
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage full or blocked: the app still works for this session */
  }
}

function isoNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** Tomorrow's date (YYYY-MM-DD) in the site's own time zone. */
function tomorrowAt(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + 86_400_000))
}

async function fetchSnapshot(): Promise<Snapshot> {
  const me: Me = USE_MOCKS ? (meCrewMock as Me) : await api.me()
  const siteId = me.site_ids[0]
  if (!siteId) throw { error: 'forbidden', message: 'No site is assigned to you yet.', request_id: 'local' } satisfies ApiError
  const [detail, allAlerts, reportsRes] = await Promise.all([api.site(siteId), api.alerts(), api.reports(siteId)])
  const briefing = await api.briefing(siteId, tomorrowAt(detail.site.timezone)).catch(() => null)

  let data = { me, detail, alerts: allAlerts.alerts.filter((a) => a.site_id === siteId), briefing, reports: reportsRes.reports }
  let serverOffsetMs = Date.parse(detail.server_time) - Date.now()
  if (USE_MOCKS) {
    data = shiftTimes(data, demoOffsetMs(detail.server_time))
    const withStrike = applySimulatedStrike(data.detail, data.alerts)
    data = { ...data, detail: withStrike.detail, alerts: withStrike.alerts }
    serverOffsetMs = 0 // the sample world runs on the phone's own clock
  }
  return { savedAt: Date.now(), serverOffsetMs, ...data }
}

/** Reports made on this phone, kept so they still show after a refresh in demo mode. */
function mergeReports(fromServer: Report[], local: Report[]): Report[] {
  const seen = new Set(fromServer.map((r) => r.client_id))
  return [...local.filter((r) => !seen.has(r.client_id)), ...fromServer].sort((a, b) => b.captured_at.localeCompare(a.captured_at))
}

/** Demo mode: turn the canned server answer into a report that reflects what the crew member entered. */
function demoReport(created: Report, p: ReportRequest, me: Me): Report {
  return {
    ...created,
    report_id: `rpt_${p.client_id.slice(0, 4)}`,
    client_id: p.client_id,
    site_id: p.site_id,
    lat: p.lat,
    lon: p.lon,
    note: p.note,
    photo_url: '',
    captured_at: p.captured_at,
    uploaded_at: isoNow(),
    reported_by: { user_id: me.user_id, name: me.name },
    triage: created.triage
      ? {
          ...created.triage,
          hazard: p.reporter_hazard ?? created.triage.hazard,
          description: 'Sample suggestion for the demo. In the live app, AI reads your photo and suggests the hazard type and how serious it is.',
          confidence: 0.5,
        }
      : null,
    status: 'pending_review',
    confirmed_hazard: null,
    confirmed_severity: null,
    ledger_record_id: null,
  }
}

interface CrewValue {
  status: 'loading' | 'ready' | 'error'
  error: string | null
  me: Me | null
  detail: SiteDetail | null
  briefing: Briefing | null
  reports: Report[]
  alerts: Alert[]
  /** The active lightning stop-work alert, if any. */
  activeAlert: Alert | null
  /** ISO time the stop-work ends (restarts on every new strike), or null. */
  stopWorkUntil: string | null
  /** Seconds left, from the phone's clock plus the server correction. Works offline. */
  secondsLeftNow: () => number
  queue: QueueItem[]
  acks: Record<string, string>
  refresh: () => Promise<void>
  acknowledge: (alertId: string) => Promise<void>
  submitReport: (req: Omit<ReportRequest, 'client_id' | 'captured_at'> & { captured_at?: string }, photo: Blob) => Promise<void>
  simulateStrike: () => Promise<void>
  resetDemo: () => Promise<void>
}

const Ctx = createContext<CrewValue | null>(null)

export interface Identity {
  userId: string | null
  name: string | null
}

export function CrewDataProvider({ children, enabled, identity }: { children: ReactNode; enabled: boolean; identity: Identity }) {
  const { online, markFresh } = useFreshness()
  // Saved data is kept per person, so people sharing a phone never see each other's data.
  const CACHE_KEY = userKey('cw:crew-cache', identity.userId)
  const ACK_KEY = userKey('cw:acks', identity.userId)
  const LOCAL_REPORTS_KEY = userKey('cw:local-reports', identity.userId)
  const [snap, setSnap] = useState<Snapshot | null>(() => readJson<Snapshot | null>(CACHE_KEY, null))
  const [status, setStatus] = useState<CrewValue['status']>(() => (readJson(CACHE_KEY, null) ? 'ready' : 'loading'))
  const [error, setError] = useState<string | null>(null)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [acks, setAcks] = useState<Record<string, string>>(() => readJson(ACK_KEY, {}))
  const [localReports, setLocalReports] = useState<Report[]>(() => readJson(LOCAL_REPORTS_KEY, []))
  const snapRef = useRef(snap)
  snapRef.current = snap
  const idRef = useRef(identity)
  idRef.current = identity
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const flushing = useRef(false)

  const listMine = useCallback(async () => (await listQueue().catch(() => [] as QueueItem[])).filter((q) => !q.owner_user_id || q.owner_user_id === idRef.current.userId), [])

  const refresh = useCallback(async () => {
    if (!enabledRef.current) return
    if (!navigator.onLine) {
      if (!snapRef.current) {
        setStatus('error')
        setError('You have no signal and nothing is saved on this phone yet. Connect once so the app can save your site.')
      }
      return
    }
    try {
      const fetched = await fetchSnapshot()
      const who = idRef.current
      // Demo mode: the site assignment is sample data, but the person is the real signed-in user.
      const next = USE_MOCKS ? { ...fetched, me: { ...fetched.me, user_id: who.userId ?? fetched.me.user_id, name: who.name ?? fetched.me.name } } : fetched
      setSnap(next)
      writeJson(CACHE_KEY, next)
      markFresh(next.savedAt)
      setStatus('ready')
      setError(null)
    } catch (e) {
      const msg = (e as Partial<ApiError>)?.message ?? 'Could not reach the server.'
      setError(msg)
      setStatus(snapRef.current ? 'ready' : 'error')
    }
  }, [markFresh, CACHE_KEY])

  const flush = useCallback(async () => {
    if (flushing.current || !navigator.onLine || !enabledRef.current) return
    flushing.current = true
    try {
      for (const item of await listQueue()) {
        // Only send items this person made on this phone.
        if (item.owner_user_id && item.owner_user_id !== idRef.current.userId) continue
        try {
          if (item.kind === 'create_report') {
            const photo = await getPhoto(item.photo_blob_key)
            if (photo) {
              const created = await api.createReport(item.payload, photo)
              const me = snapRef.current?.me
              const report = USE_MOCKS && me ? demoReport(created, item.payload, me) : created
              setLocalReports((prev) => {
                const next = [report, ...prev.filter((r) => r.client_id !== report.client_id)]
                writeJson(LOCAL_REPORTS_KEY, next)
                return next
              })
            }
          } else {
            await api.acknowledge(item.payload.alert_id)
          }
          await removeItem(item)
        } catch (e) {
          if ((e as Partial<ApiError>)?.error === 'duplicate') {
            await removeItem(item) // the server already has it
            continue
          }
          await bumpAttempts(item)
          break // keep order: retry this one first next time
        }
      }
    } finally {
      flushing.current = false
      setQueue(await listMine())
    }
  }, [LOCAL_REPORTS_KEY])

  // Load on start, when signal returns, and once a minute while visible.
  useEffect(() => {
    void refresh()
    void flush()
  }, [refresh, flush, online, enabled])
  useEffect(() => {
    void listMine().then(setQueue)
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refresh()
        void flush()
      }
    }, 60_000)
    return () => clearInterval(id)
  }, [refresh, flush, listMine])

  const acknowledge = useCallback(
    async (alertId: string) => {
      setAcks((prev) => {
        const next = { ...prev, [alertId]: isoNow() }
        writeJson(ACK_KEY, next)
        return next
      })
      await enqueue({ client_id: crypto.randomUUID(), owner_user_id: idRef.current.userId ?? undefined, kind: 'acknowledge', created_at: isoNow(), attempts: 0, payload: { alert_id: alertId } })
      setQueue(await listMine())
      await flush()
    },
    [flush, listMine, ACK_KEY],
  )

  const submitReport = useCallback<CrewValue['submitReport']>(
    async (req, photo) => {
      const client_id = crypto.randomUUID()
      const captured_at = req.captured_at ?? isoNow()
      await enqueue(
        {
          client_id,
          owner_user_id: idRef.current.userId ?? undefined,
          kind: 'create_report',
          created_at: isoNow(),
          attempts: 0,
          payload: { ...req, client_id, captured_at },
          photo_blob_key: `photo_${client_id.slice(0, 8)}`,
        },
        photo,
      )
      setQueue(await listMine())
      await flush()
    },
    [flush, listMine],
  )

  const simulateStrike = useCallback(async () => {
    recordSimulatedStrike(Date.now())
    await refresh()
  }, [refresh])

  const resetDemo = useCallback(async () => {
    resetDemoStorage()
    try {
      localStorage.removeItem(LOCAL_REPORTS_KEY)
    } catch {
      /* ignore */
    }
    await clearQueue().catch(() => undefined)
    location.reload()
  }, [])

  const value = useMemo<CrewValue>(() => {
    const alerts = snap?.alerts ?? []
    const activeAlert = alerts.find((a) => a.status === 'active' && a.type === 'stop_work_lightning') ?? null
    const stopWorkUntil = snap?.detail.site.stop_work.stop_work_until ?? activeAlert?.stop_work_until ?? null
    const offset = snap?.serverOffsetMs ?? 0
    return {
      status,
      error,
      me: snap?.me ?? null,
      detail: snap?.detail ?? null,
      briefing: snap?.briefing ?? null,
      reports: mergeReports(snap?.reports ?? [], localReports),
      alerts,
      activeAlert,
      stopWorkUntil,
      secondsLeftNow: () => secondsLeft(stopWorkUntil, offset),
      queue,
      acks,
      refresh,
      acknowledge,
      submitReport,
      simulateStrike,
      resetDemo,
    }
  }, [snap, status, error, queue, acks, localReports, refresh, acknowledge, submitReport, simulateStrike, resetDemo])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useCrew(): CrewValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useCrew must be used inside <CrewDataProvider>')
  return v
}
