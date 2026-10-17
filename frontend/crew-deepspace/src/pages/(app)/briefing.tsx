import { Screen, Card, LevelBadge, HazardName, Message } from '../../components/ui-bits'
import { useCrew } from '../../lib/crewData'
import { clock, dayLabel, hhmm, tzAbbrev } from '../../lib/time'

export default function BriefingPage() {
  const { briefing, detail } = useCrew()
  const tz = detail?.site.timezone ?? 'America/New_York'

  if (!briefing) {
    return (
      <Screen title="Tomorrow's briefing">
        <Message>No briefing yet. The next-day safety briefing is written each evening at 6 PM, site time.</Message>
      </Screen>
    )
  }
  const win = briefing.best_work_window
  return (
    <Screen title="Tomorrow's briefing">
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="text-sm font-bold">{dayLabel(briefing.for_date)}</div>
          <LevelBadge level={briefing.risk_level} />
        </div>
        <p className="mt-2 text-xl font-bold leading-snug">{briefing.headline}</p>
        <p className="mt-1 text-base">Forecast hazard score {briefing.hazard_score_forecast.toFixed(1)} / 10</p>
        {win && (
          <div className="mt-3 rounded-xl border-2 border-border bg-secondary p-3">
            <div className="text-sm font-bold">Best work window</div>
            <div className="text-2xl font-bold">{hhmm(win.start_local)} to {hhmm(win.end_local)} {tzAbbrev(tz)}</div>
            <p className="text-base">{win.reason}</p>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-bold">What to expect</h2>
        <ul className="flex flex-col divide-y-2 divide-border">
          {briefing.items.map((it, i) => (
            <li key={i} className="py-3">
              <div className="mb-1 flex items-center justify-between gap-3">
                <HazardName hazard={it.hazard} />
                <LevelBadge level={it.level} />
              </div>
              <p className="text-base leading-relaxed">{it.text}</p>
              <p className="text-sm">Sources: {it.source_ids.join(', ')}</p>
            </li>
          ))}
        </ul>
        {briefing.missing_data.length > 0 && (
          <p className="mt-2 rounded-md bg-warning px-2 py-1 text-base font-bold">Missing data: {briefing.missing_data.join(', ')}</p>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-bold">Where this came from</h2>
        <ul className="flex flex-col gap-1 text-base">
          {briefing.sources.map((s) => (
            <li key={s.id}>
              <span className="font-bold">{s.id}</span>: {s.description} ({s.source}, {clock(s.observed_at, tz)} {tzAbbrev(tz)})
            </li>
          ))}
        </ul>
        <p className="mt-2 text-sm">
          Written {clock(briefing.generated_at, tz)} {tzAbbrev(tz)}. {briefing.validated ? 'Checked against its sources.' : 'Not yet checked against its sources.'} Saved on this phone, so it works without signal.
        </p>
      </Card>
      <p className="text-sm leading-relaxed">{briefing.disclaimer}</p>
    </Screen>
  )
}
