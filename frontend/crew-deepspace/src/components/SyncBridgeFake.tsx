/**
 * TEST ONLY. Stands in for DeepSpace records in browser tests: polls a tiny test server instead of a
 * WebSocket. Compiled in only when VITE_FAKE_SYNC=true, so it never ships in a real build.
 */
import { useEffect, useRef } from 'react'
import type { BridgeProps, SyncState } from '../lib/sync'
import { alertKey, plainAlertId, withTimeout } from '../lib/sync'

async function post(body: unknown) {
  const res = await fetch('/__fake/write', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`fake write ${res.status}`)
}

export default function SyncBridgeFake({ siteId, onState, writerRef }: BridgeProps) {
  const ready = useRef(false)
  const data = useRef<Omit<SyncState, 'ready'>>({ strikeAt: undefined, resetAt: 0, acks: [], reports: [] })
  const last = useRef('')
  writerRef.current = {
    get ready() {
      return ready.current
    },
    setStrike: (at, byName) => withTimeout(() => (ready.current ? post({ kind: 'strike', site_id: siteId, at: at ?? 0, by_name: byName }) : Promise.reject(new Error('not_ready')))),
    markReset: (byName) => withTimeout(() => (ready.current ? post({ kind: 'reset', site_id: siteId, by_name: byName, at: Date.now() }) : Promise.reject(new Error('not_ready')))),
    sendAck: (a) => withTimeout(() => (ready.current ? post({ kind: 'ack', ...a, alert_id: alertKey(a.alert_id, data.current.resetAt) }) : Promise.reject(new Error('not_ready')))),
    sendReport: (r) => withTimeout(() => (ready.current ? post({ kind: 'report', ...r }) : Promise.reject(new Error('not_ready')))),
  }
  const anchored = useRef(false)
  useEffect(() => {
    let stop = false
    const tick = async () => {
      let state: SyncState
      try {
        const res = await fetch(`/__fake/state?site=${encodeURIComponent(siteId)}`)
        if (!res.ok) throw new Error('bad')
        const j = (await res.json()) as { strike: number | null | undefined; resetAt: number; acks: SyncState['acks']; reports: SyncState['reports'] }
        ready.current = true
        if (!anchored.current && !(j.resetAt > 0)) {
          anchored.current = true
          void post({ kind: 'anchor', site_id: siteId, at: Date.now() }).catch(() => (anchored.current = false))
        }
        data.current = { strikeAt: j.strike, resetAt: j.resetAt ?? 0, acks: j.acks.map((a) => ({ ...a, alert_id: plainAlertId(a.alert_id) })), reports: j.reports }
        state = { ready: true, ...data.current }
      } catch {
        ready.current = false
        state = { ready: false, ...data.current }
      }
      if (stop) return
      const sig = JSON.stringify(state)
      if (sig !== last.current) {
        last.current = sig
        onState(state)
      }
    }
    void tick()
    const id = setInterval(() => void tick(), 250)
    return () => {
      stop = true
      clearInterval(id)
    }
  }, [siteId, onState])
  return null
}
