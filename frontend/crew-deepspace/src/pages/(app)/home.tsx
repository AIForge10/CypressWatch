import { useState } from 'react'
import { CircleCheck, Clock, FlaskConical, OctagonAlert, Wifi, WifiOff } from 'lucide-react'
import { Screen, Card, LevelBadge, HazardName, BigButton, Message } from '../../components/ui-bits'
import { USE_MOCKS, useCrew } from '../../lib/crewData'
import { useFreshness } from '../../lib/freshness'
import { ago, clock, mmss, tzAbbrev, useNow } from '../../lib/time'

export default function SitePage() {
  const crew = useCrew()
  const { detail, status, error } = crew

  if (!detail) {
    return (
      <Screen title="Your site">
        <Message>{status === 'loading' ? 'Loading your site...' : error ?? 'Could not load your site.'}</Message>
        {status === 'error' && <BigButton onClick={() => void crew.refresh()}>Try again</BigButton>}
      </Screen>
    )
  }

  const { site, score, hazards, conditions } = detail
  return (
    <Screen title={site.name} eyebrow="Your site">
      <Countdown />
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-bold">Hazard score today</div>
            <div className="text-5xl font-bold leading-tight" data-testid="hazard-score">
              {score.hazard_score.toFixed(1)}
              <span className="text-xl font-normal"> / 10</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <LevelBadge level={score.risk_level} />
            <span className="text-sm">Site rank {site.rank} (1 = highest risk)</span>
          </div>
        </div>
        <p className="mt-3 text-base leading-relaxed">{score.explanation}</p>
        <ul className="mt-3 flex flex-col gap-1 text-base">
          {score.top_factors.slice(0, 3).map((f) => (
            <li key={f.feature} className="flex items-center gap-2">
              <span aria-hidden>{f.contribution >= 0 ? '▲' : '▼'}</span>
              <span>{f.label}</span>
              <span className="text-sm text-muted-foreground">{f.contribution >= 0 ? 'raises risk' : 'lowers risk'}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-bold">Hazards at your site</h2>
        <ul className="flex flex-col divide-y-2 divide-border">
          {hazards.map((h) => (
            <li key={h.hazard} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <HazardName hazard={h.hazard} />
                <div className="text-sm">{h.summary}</div>
              </div>
              <LevelBadge level={h.level} />
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-bold">Conditions right now</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-base">
          <Stat label="Heat index" value={conditions.heat_index_f} unit="°F" />
          <Stat label="Wind gusts" value={conditions.wind_gust_mph} unit=" mph" />
          <Stat label="Rain, last 24 h" value={conditions.rain_24h_in} unit=" in" />
          <Stat label="Soil moisture" value={conditions.soil_moisture_pct} unit="%" />
        </dl>
        <p className="mt-2 text-sm">Source: {conditions.source}, observed {clock(conditions.observed_at, site.timezone)} {tzAbbrev(site.timezone)}</p>
      </Card>

      {USE_MOCKS && <DemoControls />}
      <p className="text-sm leading-relaxed">Decision support only. Follow your company&apos;s safety procedures and your supervisor&apos;s direction.</p>
    </Screen>
  )
}

function Stat({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  return (
    <div>
      <dt className="text-sm">{label}</dt>
      {/* Missing data is null in the contract: say so, never show 0. */}
      <dd className="text-xl font-bold">{value == null ? 'No data' : `${value}${unit}`}</dd>
    </div>
  )
}

/** The centerpiece: runs on the phone's clock, so it keeps counting with no signal. */
function Countdown() {
  const crew = useCrew()
  const { online } = useFreshness()
  const now = useNow(1000)
  const { detail, activeAlert, stopWorkUntil, acks, queue } = crew
  if (!detail) return null
  const tz = detail.site.timezone
  const left = crew.secondsLeftNow()
  const everStopped = detail.site.stop_work.last_strike_at != null
  const running = stopWorkUntil != null && left > 0
  const ackAt = activeAlert ? acks[activeAlert.alert_id] : undefined
  const ackWaiting = activeAlert ? queue.some((q) => q.kind === 'acknowledge' && q.payload.alert_id === activeAlert.alert_id) : false
  void now // re-render each second

  if (running) {
    return (
      <section data-testid="countdown" aria-live="off" className="rounded-xl border-4 border-[#721c16] bg-destructive p-5 text-destructive-foreground">
        <div className="flex items-center gap-2 text-2xl font-bold">
          <OctagonAlert className="h-8 w-8" aria-hidden /> STOP WORK
        </div>
        <div className="mt-1 text-lg font-bold">Lightning within 10 miles. Shelter now.</div>
        <div role="timer" data-testid="countdown-time" className="my-3 text-center text-7xl font-bold tabular-nums">{mmss(left)}</div>
        <p className="text-lg">
          All clear at {clock(stopWorkUntil, tz)} {tzAbbrev(tz)} if there are no new strikes. Every new strike restarts the 30 minutes.
        </p>
        {detail.site.stop_work.nearest_strike_miles != null && (
          <p className="mt-1 text-base">Nearest strike {detail.site.stop_work.nearest_strike_miles} miles away. {detail.site.stop_work.strikes_last_30_min} strikes in the last 30 minutes.</p>
        )}
        {activeAlert?.simulated && (
          <p className="mt-2 flex items-center gap-2 rounded-lg bg-white px-2 py-1 text-base font-bold text-[#721c16]">
            <FlaskConical className="h-4 w-4" aria-hidden /> Simulated strike (demo)
          </p>
        )}
        {!online && (
          <p className="mt-2 flex items-center gap-2 rounded-lg bg-white px-2 py-1 text-base font-bold text-[#721c16]">
            <WifiOff className="h-4 w-4" aria-hidden /> No signal. This clock keeps running, but new strikes will not show until signal returns.
          </p>
        )}
        {crew.ackedBy.length > 0 && (
          <p data-testid="acked-by" className="mt-3 flex items-start gap-2 text-base font-bold">
            <CircleCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <span>{crew.ackedBy.length} confirmed stopped: {crew.ackedBy.map((a) => a.user_name || 'A crew member').join(', ')}</span>
          </p>
        )}
        {activeAlert && (
          <div className="mt-4">
            {ackAt ? (
              <p className="flex items-center gap-2 rounded-xl bg-white p-3 text-lg font-bold text-[#0f1b14]">
                <CircleCheck className="h-6 w-6 text-success" aria-hidden />
                You confirmed at {clock(ackAt, tz)}{ackWaiting ? '. Sends when signal returns.' : ''}
              </p>
            ) : (
              <button
                type="button"
                onClick={() => void crew.acknowledge(activeAlert.alert_id)}
                className="flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-white text-lg font-bold text-[#721c16]"
              >
                I have stopped work
              </button>
            )}
          </div>
        )}
      </section>
    )
  }

  if (everStopped && stopWorkUntil) {
    return (
      <section data-testid="countdown" className="rounded-xl border-4 border-[#14502f] bg-success p-5 text-white">
        <div className="flex items-center gap-2 text-2xl font-bold">
          <CircleCheck className="h-8 w-8" aria-hidden /> Countdown finished
        </div>
        <p className="mt-2 text-lg">
          Last strike {ago(detail.site.stop_work.last_strike_at ?? stopWorkUntil, now)}. The 30 minutes ended at {clock(stopWorkUntil, tz)} {tzAbbrev(tz)}.
        </p>
        <p className="mt-2 flex items-start gap-2 rounded-lg bg-white px-2 py-1.5 text-base font-bold text-[#0f1b14]">
          <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {online ? 'Wait for your supervisor to say work can restart.' : 'No signal, so new strikes cannot be seen. Check with your supervisor before restarting work.'}
        </p>
      </section>
    )
  }

  return (
    <section data-testid="countdown" className="rounded-xl border-4 border-[#14502f] bg-success p-5 text-white">
      <div className="flex items-center gap-2 text-2xl font-bold">
        <CircleCheck className="h-8 w-8" aria-hidden /> No stop-work right now
      </div>
      <p className="mt-2 text-lg">No lightning within 10 miles of this site. This screen turns red with a 30-minute countdown if that changes.</p>
    </section>
  )
}

function DemoControls() {
  const crew = useCrew()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<'shared' | 'local' | null>(null)
  return (
    <Card className="border-dashed">
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <FlaskConical className="h-5 w-5" aria-hidden /> Demo controls (simulated)
      </h2>
      <p className="mb-3 mt-1 text-sm">Only shown in demo mode. Nothing here touches real conditions. A simulated strike starts the countdown on every signed-in phone.</p>
      <p data-testid="sync-status" className="mb-3 flex items-center gap-2 text-sm font-bold">
        {crew.syncReady ? <Wifi className="h-4 w-4" aria-hidden /> : <WifiOff className="h-4 w-4" aria-hidden />}
        {crew.syncReady ? 'Live link to other phones: connected' : 'Live link to other phones: not connected'}
      </p>
      <div className="flex flex-col gap-3">
        <BigButton
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setResult(await crew.simulateStrike())
            setBusy(false)
          }}
        >
          Simulate a lightning strike
        </BigButton>
        {result && (
          <p data-testid="strike-result" role="status" className="rounded-lg bg-caution px-2 py-1.5 text-base font-bold text-foreground">
            {result === 'shared' ? 'Sent to every phone.' : 'Only on this phone. No live link right now, so other phones did not get it.'}
          </p>
        )}
        <button type="button" onClick={() => void crew.resetDemo()} className="min-h-12 w-full rounded-lg border border-input bg-card text-base font-bold">
          Reset demo (clears it for everyone at your site)
        </button>
      </div>
    </Card>
  )
}
