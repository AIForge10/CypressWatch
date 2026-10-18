/**
 * Which site this person works at (demo mode).
 *
 * An admin assigns it on the Team tab. The assignment is kept on the phone so the app still opens
 * at the right site with no signal. In the live app the backend supplies `site_ids` instead.
 */
import { createContext, useContext, useEffect } from 'react'
import { useQuery, useUser } from 'deepspace'
import { userKey } from './access'
import meCrewMock from '../contracts/mocks/me_crew.json'

/**
 * Demo mode: someone with no assignment yet (a judge, a new teammate) joins this site instead of waiting
 * on an admin. An admin can still move them on the Team tab. Everyone on it shares live sync and Reset.
 */
export const DEFAULT_DEMO_SITE = meCrewMock.site_ids[0] as string

export interface AssignmentState {
  /** False until we know (from the server or from what this phone saved). */
  loaded: boolean
  siteId: string | null
  isAdmin: boolean
  /** True when no admin assigned a site and the demo site was used instead. */
  isDefault?: boolean
}

export const UNKNOWN: AssignmentState = { loaded: false, siteId: null, isAdmin: false }
export const AssignmentContext = createContext<AssignmentState>(UNKNOWN)
export const useAssignment = () => useContext(AssignmentContext)

const KEY = 'cw:assignment'

export function readCachedAssignment(userId: string | null): AssignmentState | null {
  try {
    const v = localStorage.getItem(userKey(KEY, userId))
    if (!v) return null
    const p = JSON.parse(v) as { siteId: string | null; isAdmin: boolean }
    return { loaded: true, siteId: p.siteId ?? null, isAdmin: !!p.isAdmin }
  } catch {
    return null
  }
}

function saveAssignment(userId: string, s: AssignmentState) {
  try {
    localStorage.setItem(userKey(KEY, userId), JSON.stringify({ siteId: s.siteId, isAdmin: s.isAdmin }))
  } catch {
    /* storage blocked: the app still works while online */
  }
}

interface Row { user_id: string; site_id: string; site_name: string }

/** Test stand-in (compiled in only when VITE_FAKE_SYNC=true): polls a fake server instead of DeepSpace. */
function FakeAssignmentBridge({ userId, onState }: { userId: string; onState: (s: AssignmentState) => void }) {
  useEffect(() => {
    let stop = false
    const tick = async () => {
      try {
        const r = (await (await fetch('/__fake/assign')).json()) as { siteId: string | null; isAdmin: boolean }
        if (stop) return
        const s: AssignmentState = { loaded: true, siteId: r.siteId, isAdmin: r.isAdmin }
        saveAssignment(userId, s)
        onState(s)
      } catch {
        /* offline: keep what we have */
      }
    }
    void tick()
    const id = setInterval(tick, 700)
    return () => { stop = true; clearInterval(id) }
  }, [userId, onState])
  return null
}

/** Renders nothing. Reads this person's row and role live, tells the parent, and saves it for offline. */
export function AssignmentBridge(props: { userId: string; onState: (s: AssignmentState) => void }) {
  return import.meta.env.VITE_FAKE_SYNC === 'true' ? <FakeAssignmentBridge {...props} /> : <RealAssignmentBridge {...props} />
}

function RealAssignmentBridge({ userId, onState }: { userId: string; onState: (s: AssignmentState) => void }) {
  const q = useQuery<Row>('site_assignments', { where: { user_id: userId } })
  const { user, isLoading } = useUser()
  const siteId = q.records[0]?.data.site_id ?? null
  const isAdmin = user?.role === 'admin'
  const known = q.status === 'ready' && !isLoading && !!user
  useEffect(() => {
    if (!known) return
    const s: AssignmentState = { loaded: true, siteId, isAdmin }
    saveAssignment(userId, s)
    onState(s)
  }, [known, siteId, isAdmin, userId, onState])
  return null
}
