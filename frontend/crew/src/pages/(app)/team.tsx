import { useEffect, useMemo, useState } from 'react'
import { useMutations, useQuery, useUsers } from 'deepspace'
import { Screen, Card, Message } from '../../components/ui-bits'
import { useAssignment } from '../../lib/assignment'
import { api } from '../../contracts/api'
import { useFreshness } from '../../lib/freshness'
import type { SiteSummary as Site } from '../../contracts/types'

interface Row { user_id: string; user_name: string; site_id: string; site_name: string }

/** Admin only: pick which site each person works at. */
export default function TeamPage() {
  const { isAdmin } = useAssignment()
  const { online } = useFreshness()
  const { users, usersLoaded } = useUsers()
  const assigned = useQuery<Row>('site_assignments')
  const m = useMutations<Row>('site_assignments')
  const [sites, setSites] = useState<Site[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    api.sites().then((r) => setSites([...r.sites].sort((a, b) => a.name.localeCompare(b.name)))).catch(() => setErr('Could not load the site list.'))
  }, [])
  const rowByUser = useMemo(() => new Map(assigned.records.map((r) => [r.data.user_id, r])), [assigned.records])

  if (!isAdmin) {
    return (
      <Screen title="Team" eyebrow="Admin">
        <Card><p className="text-lg">Only an admin can assign sites.</p></Card>
      </Screen>
    )
  }

  async function assign(userId: string, userName: string, siteId: string) {
    setNote(null)
    setErr(null)
    const row = rowByUser.get(userId)
    const site = sites.find((s) => s.site_id === siteId)
    try {
      if (!siteId) {
        if (row) await m.removeConfirmed(row.recordId)
      } else if (row) {
        await m.putConfirmed(row.recordId, { site_id: siteId, site_name: site?.name ?? siteId })
      } else {
        await m.createConfirmed({ user_id: userId, user_name: userName, site_id: siteId, site_name: site?.name ?? siteId })
      }
      setNote(`Saved. ${userName || 'This person'} ${siteId ? `now works at ${site?.name ?? siteId}` : 'has no site'}.`)
    } catch {
      setErr('Could not save. Check your signal and try again.')
    }
  }

  return (
    <Screen columns title="Team" eyebrow="Admin" description="Choose the site each person works at. They see only that site.">
      {!online && <Message>No signal. You can assign sites once you are back online.</Message>}
      {note && <p role="status" data-testid="team-saved" className="xl:col-span-2 mb-3 rounded-lg bg-secondary px-3 py-2 text-base font-bold">{note}</p>}
      {err && <p role="alert" className="xl:col-span-2 mb-3 rounded-lg bg-caution px-3 py-2 text-base font-bold">{err}</p>}
      {!usersLoaded ? (
        <p role="status" className="text-lg">Loading people...</p>
      ) : users.length === 0 ? (
        <Card><p className="text-lg">Nobody has signed in yet.</p></Card>
      ) : (
        <ul className="grid gap-3 xl:col-span-2 xl:grid-cols-2">
          {users.map((u) => {
            const current = rowByUser.get(u.id)?.data.site_id ?? ''
            return (
              <li key={u.id}>
                <Card>
                  <p className="text-lg font-bold">{u.name || u.email || 'Unnamed'}</p>
                  {u.email && <p className="text-base text-muted-foreground">{u.email}</p>}
                  <label className="mt-3 block text-base font-bold" htmlFor={`site-${u.id}`}>Site</label>
                  <select
                    id={`site-${u.id}`}
                    data-testid={`assign-${u.id}`}
                    value={current}
                    disabled={!online || sites.length === 0}
                    onChange={(e) => void assign(u.id, u.name || u.email || '', e.target.value)}
                    className="mt-1 min-h-14 w-full rounded-lg border border-border bg-card px-3 text-lg"
                  >
                    <option value="">No site</option>
                    {sites.map((s) => (
                      <option key={s.site_id} value={s.site_id}>{s.name} ({s.county})</option>
                    ))}
                  </select>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </Screen>
  )
}
