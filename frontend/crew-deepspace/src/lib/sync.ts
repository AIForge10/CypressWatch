/** Types shared by the live-sync bridge and the crew data layer. */
import { createContext } from 'react'

export interface SyncedAck {
  alert_id: string
  user_id: string
  user_name: string
  acked_at: string
}

export interface SyncedReport {
  client_id: string
  site_id: string
  hazard: string
  note: string
  lat: number
  lon: number
  captured_at: string
  uploaded_at: string
  user_id: string
  user_name: string
  status: string
}

/** What the shared records say right now. */
export interface SyncState {
  /** The connection to the shared records is up and accepting writes. */
  ready: boolean
  /** ms time of the latest simulated strike; null = cleared; undefined = nobody has set one yet. */
  strikeAt: number | null | undefined
  /** ms time of the latest "Reset demo" (0 = never). Confirmations and reports older than this are ignored. */
  resetAt: number
  acks: SyncedAck[]
  reports: SyncedReport[]
}

export interface AckOut {
  client_id: string
  site_id: string
  alert_id: string
  user_name: string
  acked_at: string
}

export interface ReportOut {
  client_id: string
  site_id: string
  hazard: string
  note: string
  lat: number
  lon: number
  captured_at: string
  uploaded_at: string
  user_name: string
}

/** Every method rejects when the shared link isn't ready or doesn't answer in time. Callers keep the item queued. */
export interface SyncWriter {
  ready: boolean
  setStrike: (at: number | null, byName: string) => Promise<void>
  /** Record "Reset demo" for everyone. Nothing is deleted; every phone just ignores older confirmations and reports. */
  markReset: (byName: string) => Promise<void>
  sendAck: (a: AckOut) => Promise<void>
  sendReport: (r: ReportOut) => Promise<void>
}

export interface BridgeProps {
  siteId: string
  onState: (s: SyncState) => void
  writerRef: { current: SyncWriter | null }
}

/** True once the SDK's record connection exists (it is missing while the sign-in check hasn't finished). */
export const RecordsReadyContext = createContext(false)

/**
 * A confirmation is stored once per person per alert. To let people confirm the same alert again after
 * "Reset demo", the stored key carries the reset time: `<alert_id>@<resetAt>`.
 */
export const alertKey = (alertId: string, resetAt: number) => `${alertId}@${resetAt}`
export const plainAlertId = (key: string) => key.split('@')[0] ?? key

export const WRITE_TIMEOUT_MS = 8000

export function withTimeout<V>(work: () => Promise<V>, ms = WRITE_TIMEOUT_MS): Promise<V> {
  return new Promise<V>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('sync_timeout')), ms)
    work().then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}
