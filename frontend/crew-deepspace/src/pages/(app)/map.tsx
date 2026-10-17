import { Screen, Card, HazardName, Message } from '../../components/ui-bits'
import { useCrew } from '../../lib/crewData'
import { ago, useNow } from '../../lib/time'

const SIZE = 300

/**
 * A simple local map: your site in the middle, hazard reports around it.
 * It draws no street tiles on purpose, so it works with no signal at all.
 */
export default function MapPage() {
  const { detail, reports, queue } = useCrew()
  const now = useNow(30_000)
  if (!detail) {
    return (
      <Screen title="Hazard map" eyebrow="Reports near you">
        <Message>The map is not loaded yet.</Message>
      </Screen>
    )
  }
  const { lat: lat0, lon: lon0 } = detail.site
  const k = Math.cos((lat0 * Math.PI) / 180)
  const waiting = queue.flatMap((q) => (q.kind === 'create_report' ? [q.payload] : []))
  const pts = [
    ...reports.map((r) => ({ lat: r.lat, lon: r.lon })),
    ...waiting.map((w) => ({ lat: w.lat, lon: w.lon })),
  ]
  const span = Math.max(0.004, ...pts.flatMap((p) => [Math.abs((p.lon - lon0) * k), Math.abs(p.lat - lat0)])) * 1.5
  const xy = (lat: number, lon: number) => ({ x: SIZE / 2 + (((lon - lon0) * k) / span) * (SIZE / 2), y: SIZE / 2 - ((lat - lat0) / span) * (SIZE / 2) })
  const feet = Math.round(span * 364_000) // degrees of latitude to feet, rounded

  return (
    <Screen title="Hazard map" eyebrow="Reports near you">
      <Card className="p-2">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`Map of hazard reports around ${detail.site.name}`} className="w-full rounded-lg bg-secondary">
          <line x1={SIZE / 2} y1="0" x2={SIZE / 2} y2={SIZE} stroke="#b9c7be" strokeWidth="1" />
          <line x1="0" y1={SIZE / 2} x2={SIZE} y2={SIZE / 2} stroke="#b9c7be" strokeWidth="1" />
          <rect x={SIZE / 2 - 9} y={SIZE / 2 - 9} width="18" height="18" fill="#155d46" stroke="#17201c" strokeWidth="2" />
          <text x={SIZE / 2} y={SIZE / 2 + 28} textAnchor="middle" fontSize="13" fontWeight="700" fill="#17201c">Site center</text>
          {reports.map((r, i) => {
            const p = xy(r.lat, r.lon)
            return (
              <g key={r.report_id}>
                <circle cx={p.x} cy={p.y} r="13" fill="#b42318" stroke="#fff" strokeWidth="2" />
                <text x={p.x} y={p.y + 5} textAnchor="middle" fontSize="14" fontWeight="700" fill="#fff">{i + 1}</text>
              </g>
            )
          })}
          {waiting.map((w, i) => {
            const p = xy(w.lat, w.lon)
            return (
              <g key={w.client_id}>
                <circle cx={p.x} cy={p.y} r="13" fill="#fff" stroke="#b42318" strokeWidth="3" strokeDasharray="4 3" />
                <text x={p.x} y={p.y + 5} textAnchor="middle" fontSize="14" fontWeight="700" fill="#b42318">{`W${i + 1}`}</text>
              </g>
            )
          })}
        </svg>
        <p className="px-2 pb-1 pt-2 text-sm">Edge of map is about {feet.toLocaleString()} ft from site center. Numbered circles are reports. Dashed W circles are waiting to upload.</p>
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-bold">Reports near your site</h2>
        {reports.length === 0 && waiting.length === 0 && <p className="text-base">No hazard reports yet. Use the Report tab to add one.</p>}
        <ul className="flex flex-col divide-y-2 divide-border">
          {reports.map((r, i) => {
            const hazard = r.confirmed_hazard ?? r.triage?.hazard ?? null
            const severity = r.confirmed_severity ?? r.triage?.severity ?? null
            return (
              <li key={r.report_id} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-destructive text-sm font-bold text-white">{i + 1}</span>
                    {hazard ? <HazardName hazard={hazard} /> : <span className="font-bold">Hazard</span>}
                  </span>
                  <span className="text-sm font-bold">{severity ? `${severity[0].toUpperCase()}${severity.slice(1)} severity` : 'Severity not set'}</span>
                </div>
                <p className="mt-1 text-base">{r.note}</p>
                {r.triage && <p className="text-sm">AI suggestion: {r.triage.description}</p>}
                <p className="text-sm">
                  {r.reported_by.name}, {ago(r.uploaded_at, now)}. {r.status === 'confirmed' ? 'Confirmed by supervisor.' : r.status === 'dismissed' ? 'Dismissed by supervisor.' : 'Waiting for supervisor review.'}
                </p>
              </li>
            )
          })}
          {waiting.map((w, i) => (
            <li key={w.client_id} className="py-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-dashed border-destructive text-xs font-bold text-destructive">{`W${i + 1}`}</span>
                {w.reporter_hazard ? <HazardName hazard={w.reporter_hazard} /> : <span className="font-bold">Hazard</span>}
              </div>
              <p className="mt-1 text-base">{w.note}</p>
              <p className="text-sm font-bold">Waiting to upload. It sends on its own when signal returns.</p>
            </li>
          ))}
        </ul>
      </Card>
    </Screen>
  )
}
