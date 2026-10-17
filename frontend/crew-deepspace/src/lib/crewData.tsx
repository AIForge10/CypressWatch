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
import { siteKey } from './access'
import { applySimulatedStrike, clearSimulatedStrike, demoOffsetMs, readSimulatedStrike, recordSimulatedStrike, resetDemoStorage, shiftTimes } from './demoTime'
import { SyncBridge } from '../components/SyncBridge'
import { RecordsReadyContext, type SyncedAck, type SyncedReport, type SyncState, type SyncWriter } from './sync'
import { useFreshness } from './freshness'
import { bumpAttempts, clearQueueFor, enqueue, getPhoto, listQueue, removeItem, type QueueItem } from './queue'

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

const SAMPLE_SITE = meCrewMock.site_ids[0] as string

/** Demo mode: the sample world has one site. Present it as the site this person was assigned to. */
async function asAssignedSite<D extends { detail: SiteDetail }>(data: D, siteId: string): Promise<D> {
  const list = await api.sites().then((r) => r.sites).catch(() => [])
  const s = list.find((x) => x.site_id === siteId)
  const swapped = JSON.parse(JSON.stringify(data).split(SAMPLE_SITE).join(siteId)) as D
  if (s) {
    // Move the sample reports to the assigned site's location too, so they sit next to it on the map.
    const dLat = s.lat - data.detail.site.lat
    const dLon = s.lon - data.detail.site.lon
    const withReports = swapped as unknown as { reports?: { lat: number; lon: number }[] }
    if (withReports.reports) withReports.reports = withReports.reports.map((r) => ({ ...r, lat: r.lat + dLat, lon: r.lon + dLon }))
    swapped.detail = { ...swapped.detail, site: { ...swapped.detail.site, site_id: s.site_id, name: s.name, county: s.county, state: s.state, lat: s.lat, lon: s.lon, plant_type: s.plant_type, eia_plant_id: s.eia_plant_id } }
  }
  return swapped
}

async function fetchSnapshot(sharedStart?: number, assignedSite?: string | null): Promise<Snapshot> {
  const me: Me = USE_MOCKS ? ({ ...(meCrewMock as Me), site_ids: assignedSite ? [assignedSite] : [] }) : await api.me()
  const siteId = me.site_ids[0]
  if (!siteId) throw { error: 'forbidden', message: 'No site is assigned to you yet.', request_id: 'local' } satisfies ApiError
  const fetchId = USE_MOCKS ? SAMPLE_SITE : siteId
  const [detail, allAlerts, reportsRes] = await Promise.all([api.site(fetchId), api.alerts(), api.reports(fetchId)])
  const briefing = await api.briefing(fetchId, tomorrowAt(detail.site.timezone)).catch(() => null)

  let data = { me, detail, alerts: allAlerts.alerts.filter((a) => a.site_id === fetchId), briefing, reports: reportsRes.reports }
  if (USE_MOCKS) data = await asAssignedSite(data, siteId)
  let serverOffsetMs = Date.parse(detail.server_time) - Date.now()
  if (USE_MOCKS) {
    data = shiftTimes(data, demoOffsetMs(detail.server_time, sharedStart, siteId))
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

/** A report another phone shared. No photo here; the AI suggestion only exists on the phone that sent it. */
function syncedToReport(x: SyncedReport): Report {
  return {
    report_id: `rpt_${x.client_id.slice(0, 4)}`,
    client_id: x.client_id,
    site_id: x.site_id,
    lat: x.lat,
    lon: x.lon,
    note: x.note,
    photo_url: '',
    captured_at: x.captured_at,
    uploaded_at: x.uploaded_at,
    reported_by: { user_id: x.user_id, name: x.user_name || 'A crew member' },
    triage: null,
    status: x.status === 'confirmed' || x.status === 'dismissed' ? x.status : 'pending_review',
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
  /** Crew who confirmed the current stop-work on their own phones (live, from the shared records). */
  ackedBy: SyncedAck[]
  /** True when this phone is connected to the shared records right now. */
  syncReady: boolean
  refresh: () => Promise<void>
  acknowledge: (alertId: string) => Promise<void>
  submitReport: (req: Omit<ReportRequest, 'client_id' | 'captured_at'> & { captured_at?: string }, photo: Blob) => Promise<void>
  /** 'shared' = every phone gets it; 'local' = only this phone (no live link right now). */
  simulateStrike: () => Promise<'shared' | 'local'>
  resetDemo: () => Promise<void>
}

const Ctx = createContext<CrewValue | null>(null)

export interface Identity {
  userId: string | null
  name: string | null
}

export function CrewDataProvider({ children, enabled, identity, assignedSite = null }: { children: ReactNode; enabled: boolean; identity: Identity; assignedSite?: string | null }) {
  const { online, markFresh } = useFreshness()
  // Saved data is kept per person, so people sharing a phone never see each other's data.
  const CACHE_KEY = siteKey('cw:crew-cache', identity.userId, assignedSite)
  const ACK_KEY = siteKey('cw:acks', identity.userId, assignedSite)
  const LOCAL_REPORTS_KEY = siteKey('cw:local-reports', identity.userId, assignedSite)
  const RESET_SEEN_KEY = siteKey('cw:reset-seen', identity.userId, assignedSite)
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
  const siteRef = useRef(assignedSite)
  siteRef.current = assignedSite
  const flushing = useRef(false)
  const recordsReady = useContext(RecordsReadyContext)
  const [sync, setSync] = useState<SyncState | null>(null)
  const syncRef = useRef(sync)
  syncRef.current = sync
  const writerRef = useRef<SyncWriter | null>(null)

  const listMine = useCallback(async () => (await listQueue().catch(() => [] as QueueItem[])).filter((q) => !q.owner_user_id || q.owner_user_id === idRef.current.userId), [])

  const refresh = useCallback(async () => {
    if (!enabledRef.current) return
    if (USE_MOCKS && !siteRef.current) return // demo mode: nothing to load until a site is assigned
    if (!navigator.onLine) {
      if (!snapRef.current) {
        setStatus('error')
        setError('You have no signal and nothing is saved on this phone yet. Connect once so the app can save your site.')
      }
      return
    }
    try {
      const fetched = await fetchSnapshot(USE_MOCKS ? syncRef.current?.resetAt || undefined : undefined, siteRef.current)
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
              if (USE_MOCKS) {
                // Demo mode: share the report through the live records (text only; the photo stays here).
                const w = writerRef.current
                if (!w?.ready) throw new Error('sync_not_ready')
                const p = item.payload
                await w.sendReport({ client_id: p.client_id, site_id: p.site_id, hazard: p.reporter_hazard ?? '', note: p.note, lat: p.lat, lon: p.lon, captured_at: p.captured_at, uploaded_at: isoNow(), user_name: idRef.current.name ?? '' })
              }
              const me = snapRef.current?.me
              const report = USE_MOCKS && me ? demoReport(created, item.payload, me) : created
              setLocalReports((prev) => {
                const next = [report, ...prev.filter((r) => r.client_id !== report.client_id)]
                writeJson(LOCAL_REPORTS_KEY, next)
                return next
              })
            }
          } else if (USE_MOCKS) {
            const w = writerRef.current
            if (!w?.ready) throw new Error('sync_not_ready')
            const sid = snapRef.current?.detail.site.site_id ?? ''
            await w.sendAck({ client_id: item.client_id, site_id: sid, alert_id: item.payload.alert_id, user_name: idRef.current.name ?? '', acked_at: item.created_at })
          } else {
            await api.acknowledge(item.payload.alert_id)
          }
          await removeItem(item)
        } catch (e) {
          if ((e as Partial<ApiError>)?.error === 'duplicate' || /unique|duplicate|already/i.test(String((e as Error)?.message))) {
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

  // An admin moved this person to another site: drop the old site's data and load the new one.
  useEffect(() => {
    if (!USE_MOCKS || !assignedSite) return
    if (snapRef.current && snapRef.current.detail.site.site_id !== assignedSite) {
      setSnap(null)
      setStatus('loading')
    }
    void refresh()
  }, [assignedSite, refresh])
  // The shared strike time changed: this phone adopts it (and keeps it saved for offline use).
  const sharedStrike = sync?.strikeAt
  useEffect(() => {
    if (!USE_MOCKS || sharedStrike === undefined) return
    const site = siteRef.current
    if (!site || sharedStrike === readSimulatedStrike(site)) return
    if (sharedStrike === null) clearSimulatedStrike(site)
    else recordSimulatedStrike(sharedStrike, site)
    void refresh()
  }, [sharedStrike, refresh])
  // Someone pressed "Reset demo": forget what this phone saved about confirmations and reports from before it.
  const sharedReset = sync?.resetAt ?? 0
  useEffect(() => {
    if (!USE_MOCKS || !sharedReset) return
    try {
      if (sharedReset <= Number(localStorage.getItem(RESET_SEEN_KEY) ?? 0)) return
      localStorage.setItem(RESET_SEEN_KEY, String(sharedReset))
    } catch {
      /* storage blocked: clear anyway */
    }
    setAcks({})
    writeJson(ACK_KEY, {})
    setLocalReports([])
    writeJson(LOCAL_REPORTS_KEY, [])
  }, [sharedReset, ACK_KEY, LOCAL_REPORTS_KEY, RESET_SEEN_KEY])
  // The shared start of the sample world became known or changed: rebuild the snapshot so every phone's timer lines up.
  useEffect(() => {
    if (USE_MOCKS && sharedReset) void refresh()
  }, [sharedReset, refresh])
  // The live link just came up: send anything that was waiting.
  const syncReady = sync?.ready ?? false
  useEffect(() => {
    if (syncReady) void flush()
  }, [syncReady, flush])

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

  const simulateStrike = useCallback(async (): Promise<'shared' | 'local'> => {
    const at = Date.now()
    if (siteRef.current) recordSimulatedStrike(at, siteRef.current) // this phone reacts at once
    await refresh()
    try {
      const w = writerRef.current
      if (!w?.ready) throw new Error('sync_not_ready')
      await w.setStrike(at, idRef.current.name ?? '')
      return 'shared'
    } catch {
      return 'local'
    }
  }, [refresh])

  const resetDemo = useCallback(async () => {
    // Clear the shared strike for everyone first (best effort), then this phone.
    try {
      const w = writerRef.current
      if (w) await Promise.all([w.setStrike(null, idRef.current.name ?? ''), w.markReset(idRef.current.name ?? '')])
    } catch {
      /* no live link: only this phone is reset */
    }
    // Only this person's saved copy for this site. Other sites and other people on this phone keep theirs.
    resetDemoStorage(siteRef.current ?? 'none', [CACHE_KEY, ACK_KEY, LOCAL_REPORTS_KEY, RESET_SEEN_KEY])
    await clearQueueFor(idRef.current.userId).catch(() => undefined)
    location.reload()
  }, [CACHE_KEY, ACK_KEY, LOCAL_REPORTS_KEY, RESET_SEEN_KEY])

  const value = useMemo<CrewValue>(() => {
    const alerts = snap?.alerts ?? []
    const activeAlert = alerts.find((a) => a.status === 'active' && a.type === 'stop_work_lightning') ?? null
    const stopWorkUntil = snap?.detail.site.stop_work.stop_work_until ?? activeAlert?.stop_work_until ?? null
    const offset = snap?.serverOffsetMs ?? 0
    const resetAt = sync?.resetAt ?? 0
    const ackedBy = activeAlert ? (sync?.acks ?? []).filter((a) => a.alert_id === activeAlert.alert_id && Date.parse(a.acked_at) >= resetAt) : []
    // "Did I already confirm?" also reads the shared list, so clearing this phone's storage can't bring the button back.
    const myShared = activeAlert ? (sync?.acks ?? []).find((a) => a.user_id === identity.userId && a.alert_id === activeAlert.alert_id && Date.parse(a.acked_at) >= resetAt) : undefined
    const acksOut = activeAlert && myShared && !acks[activeAlert.alert_id] ? { ...acks, [activeAlert.alert_id]: myShared.acked_at } : acks
    const mine = new Set(localReports.map((l) => l.client_id))
    const others = (sync?.reports ?? []).filter((x) => !mine.has(x.client_id) && Date.parse(x.uploaded_at) >= resetAt).map(syncedToReport)
    return {
      status,
      error,
      me: snap?.me ?? null,
      detail: snap?.detail ?? null,
      briefing: snap?.briefing ?? null,
      reports: mergeReports([...(snap?.reports ?? []), ...others], localReports),
      alerts,
      activeAlert,
      stopWorkUntil,
      secondsLeftNow: () => secondsLeft(stopWorkUntil, offset),
      queue,
      acks: acksOut,
      ackedBy,
      syncReady,
      refresh,
      acknowledge,
      submitReport,
      simulateStrike,
      resetDemo,
    }
  }, [snap, status, error, queue, acks, localReports, sync, refresh, acknowledge, submitReport, simulateStrike, resetDemo, identity.userId])

  // Demo mode only: connect to the shared records once the site is known and the record connection exists.
  const syncSite = USE_MOCKS && enabled && recordsReady ? assignedSite : null

  return (
    <Ctx.Provider value={value}>
      {syncSite && <SyncBridge siteId={syncSite} onState={setSync} writerRef={writerRef} />}
      {children}
    </Ctx.Provider>
  )
}

export function useCrew(): CrewValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useCrew must be used inside <CrewDataProvider>')
  return v
}
