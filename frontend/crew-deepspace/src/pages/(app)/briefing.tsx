import { Screen, Card, LevelBadge, HazardName, Message } from '../../components/ui-bits'
import { useCrew } from '../../lib/crewData'
import { HAZARD_ES, HAZARDS, LEVEL_ES, LEVELS } from '../../lib/hazards'
import { useLanguage } from '../../lib/language'
import { clock, dayLabel, hhmm, tzAbbrev } from '../../lib/time'

const TEXT = {
  en: {
    title: "Tomorrow's briefing", eyebrow: 'Plan ahead', none: 'No briefing yet. The next-day safety briefing is written each evening at 6 PM, site time.',
    forecast: 'Forecast hazard score', window: 'Best work window', expect: 'What to expect', sources: 'Sources', missing: 'Missing data',
    from: 'Where this came from', written: 'Written', checked: 'Checked against its sources.', unchecked: 'Not yet checked against its sources.',
    saved: 'Saved on this phone, so it works without signal.', locale: 'en-US',
    noEs: 'The Spanish version is not saved on this phone yet, so this is the English briefing.',
  },
  es: {
    title: 'Informe de mañana', eyebrow: 'Planifique', none: 'Todavía no hay informe. El informe de seguridad del día siguiente se escribe cada noche a las 6 PM, hora del sitio.',
    forecast: 'Índice de riesgo previsto', window: 'Mejor horario de trabajo', expect: 'Qué esperar', sources: 'Fuentes', missing: 'Faltan datos',
    from: 'De dónde viene', written: 'Escrito', checked: 'Verificado con sus fuentes.', unchecked: 'Aún no verificado con sus fuentes.',
    saved: 'Guardado en este teléfono, así que funciona sin señal.', locale: 'es-US',
    noEs: '',
  },
} as const

export default function BriefingPage() {
  const crew = useCrew()
  const { detail } = crew
  const [lang] = useLanguage()
  const wantsEs = lang === 'es'
  const briefing = wantsEs && crew.briefingEs ? crew.briefingEs : crew.briefing
  // Spanish was chosen but this phone only has the English copy (e.g. saved before the update).
  const fellBack = wantsEs && !crew.briefingEs
  const t = TEXT[briefing?.language === 'es' ? 'es' : 'en']
  const tz = detail?.site.timezone ?? 'America/New_York'
  const showEs = briefing?.language === 'es'
  // Names follow the language of the briefing itself (it may be the English copy even when Spanish is chosen).
  const hazard = (k: keyof typeof HAZARD_ES) => (showEs ? HAZARD_ES[k] : HAZARDS[k].label)
  const level = (l: keyof typeof LEVEL_ES) => (showEs ? LEVEL_ES[l] : LEVELS[l].label)

  if (!briefing) {
    return (
      <Screen title={t.title} eyebrow={t.eyebrow}>
        <Message>{t.none}</Message>
      </Screen>
    )
  }
  const win = briefing.best_work_window
  return (
    <Screen columns title={t.title} eyebrow={t.eyebrow}>
      {fellBack && <div className="xl:col-span-2"><Message>{TEXT.en.noEs}</Message></div>}
      <Card className="xl:col-span-2">
        <div className="flex items-start justify-between gap-3">
          <div className="text-sm font-bold">{dayLabel(briefing.for_date, t.locale)}</div>
          <LevelBadge level={briefing.risk_level} label={level(briefing.risk_level)} />
        </div>
        <p lang={briefing.language} className="mt-2 text-xl font-bold leading-snug">{briefing.headline}</p>
        <p className="mt-1 text-base">{t.forecast} {briefing.hazard_score_forecast.toFixed(1)} / 10</p>
        {win && (
          <div className="mt-3 rounded-xl border border-border bg-secondary p-3">
            <div className="text-sm font-bold">{t.window}</div>
            <div className="text-2xl font-bold">{hhmm(win.start_local)} {showEs ? 'a' : 'to'} {hhmm(win.end_local)} {tzAbbrev(tz)}</div>
            <p lang={briefing.language} className="text-base">{win.reason}</p>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-bold">{t.expect}</h2>
        <ul className="flex flex-col divide-y-2 divide-border">
          {briefing.items.map((it, i) => (
            <li key={i} className="py-3">
              <div className="mb-1 flex items-center justify-between gap-3">
                <HazardName hazard={it.hazard} label={hazard(it.hazard)} />
                <LevelBadge level={it.level} label={level(it.level)} />
              </div>
              <p lang={briefing.language} className="text-base leading-relaxed">{it.text}</p>
              <p className="text-sm">{t.sources}: {it.source_ids.join(', ')}</p>
            </li>
          ))}
        </ul>
        {briefing.missing_data.length > 0 && (
          <p className="mt-2 rounded-lg bg-caution px-2 py-1 text-base font-bold">{t.missing}: {briefing.missing_data.join(', ')}</p>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-bold">{t.from}</h2>
        <ul className="flex flex-col gap-1 text-base">
          {briefing.sources.map((s) => (
            <li key={s.id}>
              <span className="font-bold">{s.id}</span>: {s.description} ({s.source}, {clock(s.observed_at, tz)} {tzAbbrev(tz)})
            </li>
          ))}
        </ul>
        <p className="mt-2 text-sm">
          {t.written} {clock(briefing.generated_at, tz)} {tzAbbrev(tz)}. {briefing.validated ? t.checked : t.unchecked} {t.saved}
        </p>
      </Card>
      <p lang={briefing.language} className="text-sm leading-relaxed xl:col-span-2">{briefing.disclaimer}</p>
    </Screen>
  )
}
