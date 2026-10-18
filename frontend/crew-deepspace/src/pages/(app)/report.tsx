import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Camera, Check, CircleCheck, Clock, MapPin } from 'lucide-react'
import { Screen, Card, BigButton, Message } from '../../components/ui-bits'
import { HAZARDS, HAZARD_KEYS } from '../../lib/hazards'
import { useCrew } from '../../lib/crewData'
import { useFreshness } from '../../lib/freshness'
import { cn } from '../../lib/utils'
import type { HazardKey } from '../../contracts/types'
import { canUseWebGL } from '../../lib/geo'
import type { Pin } from '../../components/LocationPicker'
import { useT } from '../../lib/i18n'

const LocationPicker = lazy(() => import('../../components/LocationPicker'))

type Where = 'photo' | 'now' | 'map'
type Spot = { lat: number; lon: number }

/** Offline stand-in for the street map: a plain square around the site. Tap to place the pin. About 1,500 ft each way. */
function PinPad({ site, pin, onPick }: { site: Spot; pin: Pin | null; onPick: (p: Pin) => void }) {
  const { t } = useT()
  const HALF = 0.0042 // degrees of latitude from the center to the edge, about 1,500 ft
  const k = Math.cos((site.lat * Math.PI) / 180)
  const toXY = (p: Spot) => ({ x: 150 + (((p.lon - site.lon) * k) / HALF) * 150, y: 150 - ((p.lat - site.lat) / HALF) * 150 })
  const at = pin ? toXY(pin) : null
  return (
    <svg
      viewBox="0 0 300 300"
      role="img"
      aria-label={t('rep.padLabel')}
      className="w-full touch-manipulation rounded-lg bg-secondary"
      onClick={(e) => {
        const box = e.currentTarget.getBoundingClientRect()
        const x = ((e.clientX - box.left) / box.width) * 300
        const y = ((e.clientY - box.top) / box.height) * 300
        onPick({ lat: Number((site.lat - ((y - 150) / 150) * HALF).toFixed(5)), lon: Number((site.lon + ((x - 150) / 150) * (HALF / k)).toFixed(5)) })
      }}
    >
      <line x1="150" y1="0" x2="150" y2="300" stroke="#9fb7bb" />
      <line x1="0" y1="150" x2="300" y2="150" stroke="#9fb7bb" />
      <rect x="141" y="141" width="18" height="18" fill="#353531" stroke="#353531" strokeWidth="2" />
      <text x="150" y="178" textAnchor="middle" fontSize="13" fontWeight="700" fill="#353531">{t('map.center')}</text>
      {at && <circle cx={at.x} cy={at.y} r="12" fill="#9f1a10" stroke="#fff" strokeWidth="3" />}
    </svg>
  )
}

/** Shrinks a phone photo to at most 1280 px so it is quick to save and upload on weak signal. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.8))
  } catch {
    return file // if the browser cannot shrink it, send the original
  }
}

function getPosition(): Promise<{ lat: number; lon: number } | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: Number(p.coords.latitude.toFixed(5)), lon: Number(p.coords.longitude.toFixed(5)) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    )
  })
}

export default function ReportPage() {
  const { t } = useT()
  const { detail, me, queue, submitReport } = useCrew()
  const { online } = useFreshness()
  const fileRef = useRef<HTMLInputElement>(null)
  const [photo, setPhoto] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [hazard, setHazard] = useState<HazardKey | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<'sent' | 'saved' | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  // Where the hazard is. The photo spot is saved the moment the photo is taken, so walking to safety afterwards doesn't move the pin.
  const [where, setWhere] = useState<Where>('photo')
  const [photoSpot, setPhotoSpot] = useState<Spot | null>(null)
  const [locating, setLocating] = useState(false)
  const [pin, setPin] = useState<Pin | null>(null)
  const [mapBroken, setMapBroken] = useState(false)
  const [webgl] = useState(canUseWebGL)

  useEffect(() => {
    if (!photo) return setPreview(null)
    const url = URL.createObjectURL(photo)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])

  if (!detail || !me) {
    return (
      <Screen title={t('rep.title')} eyebrow={t('rep.eyebrow')}>
        <Message>{t('rep.notLoaded')}</Message>
      </Screen>
    )
  }

  async function send() {
    if (!detail) return
    if (!photo) return setProblem(t('rep.needPhoto'))
    setProblem(null)
    setBusy(true)
    const wasOnline = navigator.onLine
    if (where === 'map' && !pin) {
      setBusy(false)
      return setProblem(t('rep.needPin'))
    }
    const [blob, pos] = await Promise.all([shrink(photo), where === 'photo' && photoSpot ? Promise.resolve(photoSpot) : where === 'map' ? Promise.resolve(pin) : getPosition()])
    const spot = pos ?? { lat: detail.site.lat, lon: detail.site.lon }
    await submitReport(
      {
        site_id: detail.site.site_id,
        lat: spot.lat,
        lon: spot.lon,
        note: pos ? note.trim() : `${note.trim()} (Pin placed at site center: phone location was not available.)`.trim(),
        reporter_hazard: hazard,
      },
      blob,
    )
    setBusy(false)
    setDone(wasOnline ? 'sent' : 'saved')
    setPhoto(null)
    if (fileRef.current) fileRef.current.value = '' // so the next photo always counts as a new choice
    setHazard(null)
    setNote('')
    setWhere('photo')
    setPhotoSpot(null)
    setPin(null)
  }

  return (
    <Screen columns title={t('rep.title')} eyebrow={t('rep.eyebrow')}>
      {done && (
        <p role="status" data-testid="report-done" className="xl:col-span-2 flex items-start gap-2 rounded-xl border border-success bg-success-soft p-4 text-lg font-bold">
          {done === 'sent' ? <CircleCheck className="mt-0.5 h-6 w-6 shrink-0" aria-hidden /> : <Clock className="mt-0.5 h-6 w-6 shrink-0" aria-hidden />}
          {done === 'sent' ? t('rep.sent') : t('rep.saved')}
        </p>
      )}

      <div className="flex flex-col gap-4 xl:col-span-2 xl:grid xl:grid-cols-2 xl:items-start">
      {/* Two independent columns on wide screens, so a short card never leaves a gap under it. On a phone the wrappers vanish and `order` keeps steps 1 to 4 in sequence. */}
      <div className="contents xl:flex xl:flex-col xl:gap-4">
      <Card className="order-1">
        <h2 className="mb-2 text-lg font-bold">{t('rep.s1')}</h2>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only" aria-label={t('rep.photoInput')} data-testid="photo-input" onChange={(e) => {
            const f = e.target.files?.[0] ?? null
            setPhoto(f)
            setDone(null)
            if (f) {
              setLocating(true)
              setPhotoSpot(null)
              void getPosition().then((p) => {
                setPhotoSpot(p)
                setLocating(false)
              })
            }
          }} />
        {preview && <img src={preview} alt={t('rep.photoAlt')} className="mb-3 max-h-64 w-full rounded-lg object-cover" />}
        <BigButton onClick={() => fileRef.current?.click()}>
          <Camera className="h-6 w-6" aria-hidden /> {photo ? t('rep.retake') : t('rep.take')}
        </BigButton>
      </Card>

      <Card className="order-3">
        <h2 className="mb-2 text-lg font-bold">{t('rep.s3')}</h2>
        <div role="radiogroup" aria-label={t('rep.whereAria')} className="flex flex-col gap-2">
          {(
            [
              ['photo', t('rep.where.photo'), photo ? (locating ? t('rep.help.photoLocating') : photoSpot ? t('rep.help.photoSaved') : t('rep.help.photoMissing')) : t('rep.help.photoNone')],
              ['now', t('rep.where.now'), t('rep.help.now')],
              ['map', t('rep.where.map'), t('rep.help.map')],
            ] as [Where, string, string][]
          ).map(([k, label, help]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={where === k}
              onClick={() => {
                setWhere(k)
                setProblem(null)
              }}
              className={cn('flex min-h-14 flex-col items-start justify-center rounded-lg border-2 px-3 py-2 text-left', where === k ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card')}
            >
              <span className="flex items-center gap-2 text-base font-bold">{where === k ? <Check className="h-5 w-5" aria-hidden /> : <MapPin className="h-5 w-5" aria-hidden />}{label}</span>
              <span className="text-sm">{help}</span>
            </button>
          ))}
        </div>
        {where === 'map' && (
          <div className="mt-3">
            {online && webgl && !mapBroken ? (
              <Suspense fallback={<div className="flex h-72 items-center justify-center text-base">{t('map.loading')}</div>}>
                <LocationPicker siteLat={detail.site.lat} siteLon={detail.site.lon} pin={pin} onPick={(p) => {
                  setPin(p)
                  setProblem(null)
                }} onUnavailable={() => setMapBroken(true)} />
              </Suspense>
            ) : (
              <>
                <p className="mb-2 text-sm font-bold">{online ? t('rep.fallbackA') : t('rep.fallbackB')} {t('rep.fallbackC')}</p>
                <PinPad site={{ lat: detail.site.lat, lon: detail.site.lon }} pin={pin} onPick={(p) => {
                  setPin(p)
                  setProblem(null)
                }} />
              </>
            )}
            <p className="mt-2 flex items-center justify-between gap-2 text-sm">
              <span data-testid="pin-status">{pin ? t('rep.pinPlaced', { lat: pin.lat, lon: pin.lon }) : t('rep.pinTap')}</span>
              {pin && (
                <button type="button" onClick={() => setPin(null)} className="min-h-11 rounded-lg border-2 border-input px-3 font-bold">{t('rep.clearPin')}</button>
              )}
            </p>
          </div>
        )}
      </Card>

      </div>
      <div className="contents xl:flex xl:flex-col xl:gap-4">
      <Card className="order-2">
        <h2 className="mb-2 text-lg font-bold">{t('rep.s2')}</h2>
        <div className="grid grid-cols-2 gap-2">
          {HAZARD_KEYS.map((k) => {
            const { Icon } = HAZARDS[k]
            const label = t(`hz.${k}`)
            const on = hazard === k
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => setHazard(on ? null : k)}
                className={cn('flex min-h-14 items-center gap-2 rounded-lg border-2 px-3 text-base font-bold', on ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card')}
              >
                {on ? <Check className="h-5 w-5" aria-hidden /> : <Icon className="h-5 w-5" aria-hidden />}
                {label}
              </button>
            )
          })}
        </div>
      </Card>

      <Card className="order-4">
        <h2 className="mb-2 text-lg font-bold">{t('rep.s4')}</h2>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={280}
          placeholder={t('rep.placeholder')}
          className="w-full rounded-lg border-2 border-input bg-card p-3 text-base"
        />
      </Card>
      </div>
      </div>

      {problem && <p role="alert" className="xl:col-span-2 rounded-lg border-2 border-destructive bg-card p-3 text-base font-bold text-destructive">{problem}</p>}
      <BigButton className="xl:col-span-2" data-testid="send-report" disabled={busy} onClick={() => void send()}>
        {busy ? t('rep.saving') : online ? t('rep.send') : t('rep.saveOffline')}
      </BigButton>
      {!online && <p className="text-base xl:col-span-2">{t('rep.offlineNote')}</p>}

      {queue.length > 0 && (
        <Card className="xl:col-span-2">
          <h2 className="mb-2 text-lg font-bold">{t('rep.waitingTitle', { n: queue.length })}</h2>
          <ul className="flex flex-col gap-2 text-base">
            {queue.map((q) => (
              <li key={q.client_id} className="flex items-center gap-2">
                <Clock className="h-5 w-5 shrink-0" aria-hidden />
                {q.kind === 'create_report' ? `${t('rep.qReport')}${q.payload.note ? `: ${q.payload.note.slice(0, 40)}` : ''}` : t('rep.qAck')}
                {q.attempts > 0 && <span className="text-sm">{t('rep.tried', { n: q.attempts })}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Screen>
  )
}
