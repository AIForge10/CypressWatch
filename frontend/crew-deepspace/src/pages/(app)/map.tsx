import { lazy, Suspense, useMemo, useRef, useState, type ReactNode } from 'react'
import { Screen, Card, HazardName, Message } from '../../components/ui-bits'
import { SiteView } from '../../components/SiteView'
import { useFreshness } from '../../lib/freshness'
import type { MapPoint } from '../../components/SiteMap2D'
import { canUseWebGL } from '../../lib/geo'
import { cn } from '../../lib/utils'
import { useCrew } from '../../lib/crewData'
import { ago, useNow } from '../../lib/time'
import { useT } from '../../lib/i18n'

const SIZE = 300
const SiteMap2D = lazy(() => import('../../components/SiteMap2D'))

/**
 * Your site and the hazard reports around it.
 * With signal: a street map of just your site (same look as the supervisor map).
 * With no signal: a plain drawing with no tiles, so the screen still works.
 */
/** One report in the list. When the street map is showing, tapping it flies the map to that report. */
function PickRow({ id, canShow, selected, onPick, label, children }: { id: string; canShow: boolean; selected: boolean; onPick: (id: string) => void; label: string; children: ReactNode }) {
  if (!canShow) return <div className="py-3">{children}</div>
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => onPick(id)}
      className={cn('block w-full rounded-lg px-2 py-3 text-left hover:bg-secondary focus-visible:outline-2 focus-visible:outline-primary', selected && 'bg-secondary')}
    >
      {children}
    </button>
  )
}

export default function MapPage() {
  const { t, lang } = useT()
  const { detail, reports, queue } = useCrew()
  const now = useNow(30_000)
  const { online } = useFreshness()
  const [mapBroken, setMapBroken] = useState(false)
  const [webgl] = useState(canUseWebGL)
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null)
  const mapCard = useRef<HTMLDivElement>(null)
  const points = useMemo<MapPoint[]>(
    () => [
      ...reports.map((r, i) => ({ id: r.report_id, lat: r.lat, lon: r.lon, label: String(i + 1), kind: 'report' as const, text: r.note })),
      ...queue.flatMap((q) => (q.kind === 'create_report' ? [q] : [])).map((q, i) => ({ id: q.client_id, lat: q.payload.lat, lon: q.payload.lon, label: `W${i + 1}`, kind: 'waiting' as const, text: q.payload.note })),
    ],
    [reports, queue],
  )
  const mapShown = online && webgl && !mapBroken
  const pick = (id: string) => {
    setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }))
    mapCard.current?.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' })
  }
  if (!detail) {
    return (
      <Screen title={t('map.title')} eyebrow={t('map.eyebrowNear')}>
        <Message>{t('map.notLoaded')}</Message>
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
    <Screen columns title={t('map.titleSite', { name: detail.site.name })} eyebrow={t('home.eyebrow', { county: detail.site.county, state: detail.site.state })} description={t('map.desc')}>
      {online && webgl && !mapBroken ? (
        <div ref={mapCard} className="scroll-mt-4">
        <Card className="p-2">
          <Suspense fallback={<div className="flex h-80 items-center justify-center text-base xl:h-[26rem]">{t('map.loading')}</div>}>
            <SiteMap2D name={detail.site.name} lat={detail.site.lat} lon={detail.site.lon} score={detail.score.hazard_score} level={detail.score.risk_level} points={points} focus={focus} onUnavailable={() => setMapBroken(true)} />
          </Suspense>
          <p className="px-2 pb-1 pt-2 text-sm">{t('map.legendStreet')}</p>
        </Card>
        </div>
      ) : (
      <Card className="p-2">
        {online && mapBroken && <p className="px-2 pb-2 text-sm font-bold">{t('map.broken')}</p>}
        {!online && <p className="px-2 pb-2 text-sm font-bold">{t('map.offlineDrawing')}</p>}
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={t('map.svgLabel', { name: detail.site.name })} className="w-full rounded-lg bg-secondary">
          <line x1={SIZE / 2} y1="0" x2={SIZE / 2} y2={SIZE} stroke="#9fb7bb" strokeWidth="1" />
          <line x1="0" y1={SIZE / 2} x2={SIZE} y2={SIZE / 2} stroke="#9fb7bb" strokeWidth="1" />
          <rect x={SIZE / 2 - 9} y={SIZE / 2 - 9} width="18" height="18" fill="#353531" stroke="#353531" strokeWidth="2" />
          <text x={SIZE / 2} y={SIZE / 2 + 28} textAnchor="middle" fontSize="13" fontWeight="700" fill="#353531">{t('map.center')}</text>
          {reports.map((r, i) => {
            const p = xy(r.lat, r.lon)
            return (
              <g key={r.report_id}>
                <circle cx={p.x} cy={p.y} r="13" fill="#9f1a10" stroke="#fff" strokeWidth="2" />
                <text x={p.x} y={p.y + 5} textAnchor="middle" fontSize="14" fontWeight="700" fill="#fff">{i + 1}</text>
              </g>
            )
          })}
          {waiting.map((w, i) => {
            const p = xy(w.lat, w.lon)
            return (
              <g key={w.client_id}>
                <circle cx={p.x} cy={p.y} r="13" fill="#fff" stroke="#9f1a10" strokeWidth="3" strokeDasharray="4 3" />
                <text x={p.x} y={p.y + 5} textAnchor="middle" fontSize="14" fontWeight="700" fill="#9f1a10">{`W${i + 1}`}</text>
              </g>
            )
          })}
        </svg>
        <p className="px-2 pb-1 pt-2 text-sm">{t('map.legendDrawing', { feet: feet.toLocaleString(lang === 'es' ? 'es-US' : 'en-US') })}</p>
      </Card>
      )}

      <SiteView />

      <Card className="xl:col-span-2">
        <h2 className="mb-2 text-lg font-bold">{t('map.near')}</h2>
        {reports.length === 0 && waiting.length === 0 && <p className="text-base">{t('map.none')}</p>}
        <ul className="flex flex-col divide-y-2 divide-border">
          {reports.map((r, i) => {
            const hazard = r.confirmed_hazard ?? r.triage?.hazard ?? null
            const severity = r.confirmed_severity ?? r.triage?.severity ?? null
            return (
              <li key={r.report_id}>
                <PickRow id={r.report_id} canShow={mapShown} selected={focus?.id === r.report_id} onPick={pick} label={t('map.showReport', { n: i + 1 })}>
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-destructive text-sm font-bold text-white">{i + 1}</span>
                    {hazard ? <HazardName hazard={hazard} /> : <span className="font-bold">{t('map.hazard')}</span>}
                  </span>
                  <span className="text-sm font-bold">{severity ? t(`map.sev.${severity}`) : t('map.sev.none')}</span>
                </div>
                <p className="mt-1 text-base">{r.note}</p>
                {r.triage && <p className="text-sm">{t('map.ai', { text: r.triage.description })}</p>}
                <p className="text-sm">
                  {t('map.by', { name: r.reported_by.name, ago: ago(r.uploaded_at, now, lang) })} {r.status === 'confirmed' ? t('map.confirmed') : r.status === 'dismissed' ? t('map.dismissed') : t('map.review')}
                </p>
              </PickRow>
              </li>
            )
          })}
          {waiting.map((w, i) => (
            <li key={w.client_id}>
                <PickRow id={w.client_id} canShow={mapShown} selected={focus?.id === w.client_id} onPick={pick} label={t('map.showWaiting', { n: `W${i + 1}` })}>
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-dashed border-destructive text-xs font-bold text-destructive">{`W${i + 1}`}</span>
                {w.reporter_hazard ? <HazardName hazard={w.reporter_hazard} /> : <span className="font-bold">{t('map.hazard')}</span>}
              </div>
              <p className="mt-1 text-base">{w.note}</p>
              <p className="text-sm font-bold">{t('map.waitingUpload')}</p>
            </PickRow>
              </li>
          ))}
        </ul>
      </Card>
    </Screen>
  )
}
