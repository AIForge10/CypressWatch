import { useState } from 'react'
import { CircleCheck, Clock, FlaskConical, OctagonAlert, Wifi, WifiOff } from 'lucide-react'
import { Screen, Card, LevelBadge, HazardName, BigButton, Message } from '../../components/ui-bits'
import { USE_MOCKS, useCrew } from '../../lib/crewData'
import { useFreshness } from '../../lib/freshness'
import { ago, clock, mmss, tzAbbrev, useNow } from '../../lib/time'
import { useT } from '../../lib/i18n'
import { ERR_NO_SAVED, ERR_UNREACHABLE, ERR_NO_SITE } from '../../lib/crewData'

export default function SitePage() {
  const { t } = useT()
  const crew = useCrew()
  const { detail, status, error } = crew
  const errorText = error === ERR_NO_SAVED ? t('err.noSignalEmpty') : error === ERR_UNREACHABLE ? t('err.unreachable') : error === ERR_NO_SITE ? t('err.noSite') : error

  if (!detail) {
    return (
      <Screen title={t('home.loadingTitle')}>
        <Message>{status === 'loading' ? t('home.loading') : errorText ?? t('home.failed')}</Message>
        {status === 'error' && <BigButton onClick={() => void crew.refresh()}>{t('home.retry')}</BigButton>}
      </Screen>
    )
  }

  const { site, score, hazards, conditions } = detail
  return (
    <Screen columns title={site.name} eyebrow={t('home.eyebrow', { county: site.county, state: site.state })}>
      <div className="xl:col-span-2">
        <Countdown />
      </div>
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-bold">{t('home.score')}</div>
            <div className="text-5xl font-bold leading-tight" data-testid="hazard-score">
              {score.hazard_score.toFixed(1)}
              <span className="text-xl font-normal"> / 10</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <LevelBadge level={score.risk_level} />
            <span className="text-sm">{t('home.rank', { rank: site.rank })}</span>
          </div>
        </div>
        <p className="mt-3 text-base leading-relaxed">{score.explanation}</p>
        <ul className="mt-3 flex flex-col gap-1 text-base">
          {score.top_factors.slice(0, 3).map((f) => (
            <li key={f.feature} className="flex items-center gap-2">
              <span aria-hidden>{f.contribution >= 0 ? '▲' : '▼'}</span>
              <span>{f.label}</span>
              <span className="text-sm text-muted-foreground">{f.contribution >= 0 ? t('home.raises') : t('home.lowers')}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="xl:row-span-2">
        <h2 className="mb-2 text-lg font-bold">{t('home.hazards')}</h2>
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
        <h2 className="mb-2 text-lg font-bold">{t('home.conditions')}</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-base">
          <Stat label={t('home.heat')} value={conditions.heat_index_f} unit="°F" />
          <Stat label={t('home.gusts')} value={conditions.wind_gust_mph} unit=" mph" />
          <Stat label={t('home.rain')} value={conditions.rain_24h_in} unit=" in" />
          <Stat label={t('home.soil')} value={conditions.soil_moisture_pct} unit="%" />
        </dl>
        <p className="mt-2 text-sm">{t('home.source', { source: conditions.source, time: clock(conditions.observed_at, site.timezone), tz: tzAbbrev(site.timezone) })}</p>
      </Card>

      {USE_MOCKS && (
        <div className="xl:col-span-2">
          <DemoControls />
        </div>
      )}
      <p className="text-sm leading-relaxed xl:col-span-2">{t('home.disclaimer')}</p>
    </Screen>
  )
}

function Stat({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  const { t } = useT()
  return (
    <div>
      <dt className="text-sm">{label}</dt>
      {/* Missing data is null in the contract: say so, never show 0. */}
      <dd className="text-xl font-bold">{value == null ? t('home.noData') : `${value}${unit}`}</dd>
    </div>
  )
}

/** The centerpiece: runs on the phone's clock, so it keeps counting with no signal. */
function Countdown() {
  const { t, lang } = useT()
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
          <OctagonAlert className="h-8 w-8" aria-hidden /> {t('stop.title')}
        </div>
        <div className="mt-1 text-lg font-bold">{t('stop.why')}</div>
        <div role="timer" data-testid="countdown-time" className="my-3 text-center text-7xl font-bold tabular-nums">{mmss(left)}</div>
        <p className="text-lg">
          {t('stop.clear', { time: clock(stopWorkUntil, tz), tz: tzAbbrev(tz) })}
        </p>
        {detail.site.stop_work.nearest_strike_miles != null && (
          <p className="mt-1 text-base">{t('stop.nearest', { miles: detail.site.stop_work.nearest_strike_miles, n: t(detail.site.stop_work.strikes_last_30_min === 1 ? 'stop.nearest.one' : 'stop.nearest.many', { n: detail.site.stop_work.strikes_last_30_min }) })}</p>
        )}
        {activeAlert?.simulated && (
          <p className="mt-2 flex items-center gap-2 rounded-lg bg-white px-2 py-1 text-base font-bold text-[#721c16]">
            <FlaskConical className="h-4 w-4" aria-hidden /> {t('stop.simulated')}
          </p>
        )}
        {!online && (
          <p className="mt-2 flex items-center gap-2 rounded-lg bg-white px-2 py-1 text-base font-bold text-[#721c16]">
            <WifiOff className="h-4 w-4" aria-hidden /> {t('stop.offline')}
          </p>
        )}
        {crew.ackedBy.length > 0 && (
          <p data-testid="acked-by" className="mt-3 flex items-start gap-2 text-base font-bold">
            <CircleCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <span>{t('stop.confirmed', { n: crew.ackedBy.length, names: crew.ackedBy.map((a) => a.user_name || t('stop.crewMember')).join(', ') })}</span>
          </p>
        )}
        {activeAlert && (
          <div className="mt-4">
            {ackAt ? (
              <p className="flex items-center gap-2 rounded-xl bg-white p-3 text-lg font-bold text-foreground">
                <CircleCheck className="h-6 w-6 text-success" aria-hidden />
                {t('stop.youConfirmed', { time: clock(ackAt, tz) })}{ackWaiting ? t('stop.sendsLater') : '.'}
              </p>
            ) : (
              <button
                type="button"
                onClick={() => void crew.acknowledge(activeAlert.alert_id)}
                className="flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-white text-lg font-bold text-[#721c16]"
              >
                {t('stop.iStopped')}
              </button>
            )}
          </div>
        )}
      </section>
    )
  }

  if (everStopped && stopWorkUntil) {
    return (
      <section data-testid="countdown" className="rounded-xl border-4 border-[#1c463d] bg-success p-5 text-white">
        <div className="flex items-center gap-2 text-2xl font-bold">
          <CircleCheck className="h-8 w-8" aria-hidden /> {t('stop.doneTitle')}
        </div>
        <p className="mt-2 text-lg">
          {t('stop.doneBody', { ago: ago(detail.site.stop_work.last_strike_at ?? stopWorkUntil, now, lang), time: clock(stopWorkUntil, tz), tz: tzAbbrev(tz) })}
        </p>
        <p className="mt-2 flex items-start gap-2 rounded-lg bg-white px-2 py-1.5 text-base font-bold text-foreground">
          <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {online ? t('stop.waitSup') : t('stop.waitSupOffline')}
        </p>
      </section>
    )
  }

  return (
    <section data-testid="countdown" className="rounded-xl border-4 border-[#1c463d] bg-success p-5 text-white">
      <div className="flex items-center gap-2 text-2xl font-bold">
        <CircleCheck className="h-8 w-8" aria-hidden /> {t('stop.noneTitle')}
      </div>
      <p className="mt-2 text-lg">{t('stop.noneBody')}</p>
    </section>
  )
}

function DemoControls() {
  const { t } = useT()
  const crew = useCrew()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<'shared' | 'local' | null>(null)
  return (
    <Card className="border-dashed">
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <FlaskConical className="h-5 w-5" aria-hidden /> {t('demo.title')}
      </h2>
      <p className="mb-3 mt-1 text-sm">{t('demo.note')}</p>
      <p data-testid="sync-status" className="mb-3 flex items-center gap-2 text-sm font-bold">
        {crew.syncReady ? <Wifi className="h-4 w-4" aria-hidden /> : <WifiOff className="h-4 w-4" aria-hidden />}
        {crew.syncReady ? t('demo.linkOn') : t('demo.linkOff')}
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
          {t('demo.strike')}
        </BigButton>
        {result && (
          <p data-testid="strike-result" role="status" className="rounded-lg bg-caution px-2 py-1.5 text-base font-bold text-foreground">
            {result === 'shared' ? t('demo.shared') : t('demo.local')}
          </p>
        )}
        <button type="button" onClick={() => void crew.resetDemo()} className="min-h-12 w-full rounded-lg border border-input bg-card text-base font-bold">
          {t('demo.reset')}
        </button>
      </div>
    </Card>
  )
}
