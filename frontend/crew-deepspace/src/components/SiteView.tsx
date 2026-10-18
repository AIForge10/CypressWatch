import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Card } from './ui-bits'
import { useCrew } from '../lib/crewData'
import { useNow } from '../lib/time'
import { useT } from '../lib/i18n'

// The 3D view loads on its own so the countdown and buttons never wait for it.
const SiteBeaconScene = lazy(() => import('./SiteBeaconScene').then((m) => ({ default: m.SiteBeaconScene })))

/** A turnable 3D picture of the plant, the 10-mile safety ring and any strikes. Picture only; the countdown above is what counts. */
export function SiteView() {
  const { t } = useT()
  const crew = useCrew()
  const { detail } = crew
  const now = useNow(1000)
  void now
  const sw = detail?.site.stop_work
  const lastStrike = sw?.last_strike_at ?? null
  // A new strike plays the lightning animation once. The first load does not.
  const seen = useRef<string | null | undefined>(undefined)
  const [animationId, setAnimationId] = useState(0)
  useEffect(() => {
    if (seen.current !== undefined && lastStrike && lastStrike !== seen.current) setAnimationId((n) => n + 1)
    seen.current = lastStrike
  }, [lastStrike])
  if (!detail || !sw) return null
  const active = crew.secondsLeftNow() > 0 && sw.stop_work_until != null
  const hazard = detail.site.top_hazard
  const weather = active || hazard === 'lightning' || hazard === 'storm' ? 'storm' : hazard === 'flood' || hazard === 'soil_saturation' ? 'overcast' : 'sunny'
  const label = t(weather === 'storm' ? 'view.storm' : weather === 'overcast' ? 'view.overcast' : 'view.sunny')
  const strikes = active ? Math.max(1, Math.min(4, sw.strikes_last_30_min)) : 0
  return (
    <Card className="p-2">
      <div className="relative h-80 overflow-hidden xl:h-[26rem] rounded-lg bg-secondary" role="img" aria-label={t('view.aria', { name: detail.site.name, label, state: active ? t('view.stop') : t('view.clear'), n: strikes, strikes: strikes === 1 ? t('view.strike') : t('view.strikes') })}>
        <Suspense fallback={<div className="flex h-full items-center justify-center text-base">{t('view.loading')}</div>}>
          <SiteBeaconScene active={active} strikeCount={strikes} strikeAnimationId={animationId} weather={weather} />
        </Suspense>
        <span className="cw-beacon-tag left-2 top-2">{t('view.ring')}</span>
        <span className="cw-beacon-tag right-2 top-2">{label}</span>
      </div>
      <p className="px-2 pb-1 pt-2 text-sm">{t('view.help')}</p>
    </Card>
  )
}

