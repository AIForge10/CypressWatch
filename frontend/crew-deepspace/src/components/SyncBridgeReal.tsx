/**
 * The only file that talks to DeepSpace records for live sync.
 * Renders nothing. Reports shared state upward and hands out write functions.
 *
 * DeepSpace drops plain writes made with no connection, so every write here uses the
 * "Confirmed" version, and the crew data layer keeps its own queue and retries.
 */
import { useEffect, useRef } from 'react'
import { useMutations, useQuery } from 'deepspace'
import type { AckOut, BridgeProps, ReportOut, SyncedAck, SyncedReport, SyncState } from '../lib/sync'
import { alertKey, plainAlertId, withTimeout } from '../lib/sync'

interface StrikeRow { site_id: string; at: number; by_name: string }
type AckRow = SyncedAck & { client_id: string; site_id: string }

export default function SyncBridgeReal({ siteId, onState, writerRef }: BridgeProps) {
  const strikeQ = useQuery<StrikeRow>('demo_strike', { where: { site_id: siteId } })
  // The reset time is a second row in the same collection, keyed `<site>#reset`.
  const resetQ = useQuery<StrikeRow>('demo_strike', { where: { site_id: `${siteId}#reset` } })
  const ackQ = useQuery<AckRow>('crew_acks', { where: { site_id: siteId } })
  const repQ = useQuery<SyncedReport>('crew_reports', { where: { site_id: siteId }, orderBy: 'captured_at', orderDir: 'desc', limit: 100 })
  const strikeM = useMutations<StrikeRow>('demo_strike')
  const ackM = useMutations<AckOut>('crew_acks')
  const repM = useMutations<ReportOut>('crew_reports')
  const ready = strikeM.ready && ackM.ready && repM.ready

  const strikeRow = strikeQ.records[0]
  const resetRow = resetQ.records[0]
  const resetAt = resetRow && resetRow.data.at > 0 ? resetRow.data.at : 0
  const strikeAt: SyncState['strikeAt'] = strikeQ.status !== 'ready' || !strikeRow ? undefined : strikeRow.data.at > 0 ? strikeRow.data.at : null

  // Write functions see the latest rows on every render.
  writerRef.current = {
    ready,
    setStrike: (at, byName) =>
      withTimeout(async () => {
        if (!ready) throw new Error('not_ready')
        if (strikeRow) await strikeM.putConfirmed(strikeRow.recordId, { at: at ?? 0, by_name: byName })
        else await strikeM.createConfirmed({ site_id: siteId, at: at ?? 0, by_name: byName })
      }),
    markReset: (byName) =>
      withTimeout(async () => {
        if (!ready) throw new Error('not_ready')
        const at = Date.now()
        if (resetRow) await strikeM.putConfirmed(resetRow.recordId, { at, by_name: byName })
        else await strikeM.createConfirmed({ site_id: `${siteId}#reset`, at, by_name: byName })
      }),
    sendAck: (a) =>
      withTimeout(async () => {
        if (!ready) throw new Error('not_ready')
        // Already there from an earlier try that the server did apply: done.
        if (ackQ.records.some((r) => r.data.client_id === a.client_id)) return
        await ackM.createConfirmed({ ...a, alert_id: alertKey(a.alert_id, resetAt) }) // the server adds user_id from the login
      }),
    sendReport: (r) =>
      withTimeout(async () => {
        if (!ready) throw new Error('not_ready')
        if (repQ.records.some((x) => x.data.client_id === r.client_id)) return
        await repM.createConfirmed(r) // user_id comes from the login; status starts as pending_review
      }),
  }
  // Clean up on unmount so a late call doesn't write through a dead connection.
  useEffect(() => () => void (writerRef.current = null), [writerRef])

  // Nobody has set a shared start for the sample world yet: the first phone to connect does.
  const anchored = useRef(false)
  useEffect(() => {
    if (!ready || resetQ.status !== 'ready' || resetRow || anchored.current) return
    anchored.current = true
    void withTimeout(() => strikeM.createConfirmed({ site_id: `${siteId}#reset`, at: Date.now(), by_name: '' })).catch(() => {
      anchored.current = false // someone else got there first, or no link: try again later
    })
  })

  // Only tell the parent when something actually changed.
  const last = useRef('')
  useEffect(() => {
    const state: SyncState = {
      ready,
      strikeAt,
      resetAt,
      acks: ackQ.records.map((r) => ({ alert_id: plainAlertId(r.data.alert_id), user_id: r.data.user_id, user_name: r.data.user_name, acked_at: r.data.acked_at })),
      reports: repQ.records.map((r) => r.data),
    }
    const sig = JSON.stringify(state)
    if (sig !== last.current) {
      last.current = sig
      onState(state)
    }
  })
  return null
}
