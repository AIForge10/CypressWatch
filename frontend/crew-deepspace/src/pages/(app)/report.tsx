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

const LocationPicker = lazy(() => import('../../components/LocationPicker'))

type Where = 'photo' | 'now' | 'map'
type Spot = { lat: number; lon: number }

/** Offline stand-in for the street map: a plain square around the site. Tap to place the pin. About 1,500 ft each way. */
function PinPad({ site, pin, onPick }: { site: Spot; pin: Pin | null; onPick: (p: Pin) => void }) {
  const HALF = 0.0042 // degrees of latitude from the center to the edge, about 1,500 ft
  const k = Math.cos((site.lat * Math.PI) / 180)
  const toXY = (p: Spot) => ({ x: 150 + (((p.lon - site.lon) * k) / HALF) * 150, y: 150 - ((p.lat - site.lat) / HALF) * 150 })
  const at = pin ? toXY(pin) : null
  return (
    <svg
      viewBox="0 0 300 300"
      role="img"
      aria-label="Simple drawing of your site. Tap where the hazard is."
      className="w-full touch-manipulation rounded-lg bg-secondary"
      onClick={(e) => {
        const box = e.currentTarget.getBoundingClientRect()
        const x = ((e.clientX - box.left) / box.width) * 300
        const y = ((e.clientY - box.top) / box.height) * 300
        onPick({ lat: Number((site.lat - ((y - 150) / 150) * HALF).toFixed(5)), lon: Number((site.lon + ((x - 150) / 150) * (HALF / k)).toFixed(5)) })
      }}
    >
      <line x1="150" y1="0" x2="150" y2="300" stroke="#b9c7be" />
      <line x1="0" y1="150" x2="300" y2="150" stroke="#b9c7be" />
      <rect x="141" y="141" width="18" height="18" fill="#155d46" stroke="#17201c" strokeWidth="2" />
      <text x="150" y="178" textAnchor="middle" fontSize="13" fontWeight="700" fill="#17201c">Site center</text>
      {at && <circle cx={at.x} cy={at.y} r="12" fill="#b42318" stroke="#fff" strokeWidth="3" />}
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
      <Screen title="Report a hazard" eyebrow="Tell your supervisor">
        <Message>Your site is not loaded yet. Open the Site tab first.</Message>
      </Screen>
    )
  }

  async function send() {
    if (!detail) return
    if (!photo) return setProblem('Take a photo first.')
    setProblem(null)
    setBusy(true)
    const wasOnline = navigator.onLine
    if (where === 'map' && !pin) {
      setBusy(false)
      return setProblem('Tap the map to place the pin, or choose another way to set the location.')
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
    <Screen columns title="Report a hazard" eyebrow="Tell your supervisor">
      {done && (
        <p role="status" data-testid="report-done" className="xl:col-span-2 flex items-start gap-2 rounded-xl border border-success bg-success-soft p-4 text-lg font-bold">
          {done === 'sent' ? <CircleCheck className="mt-0.5 h-6 w-6 shrink-0" aria-hidden /> : <Clock className="mt-0.5 h-6 w-6 shrink-0" aria-hidden />}
          {done === 'sent' ? 'Report sent to your team.' : 'Saved on this phone. It uploads on its own when signal returns.'}
        </p>
      )}

      <div className="grid items-start gap-4 xl:col-span-2 xl:grid-cols-2">
      <Card className="xl:col-start-1 xl:row-start-1">
        <h2 className="mb-2 text-lg font-bold">1. Photo</h2>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Take or choose a photo" data-testid="photo-input" onChange={(e) => {
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
        {preview && <img src={preview} alt="Photo of the hazard you will report" className="mb-3 max-h-64 w-full rounded-lg object-cover" />}
        <BigButton onClick={() => fileRef.current?.click()}>
          <Camera className="h-6 w-6" aria-hidden /> {photo ? 'Retake photo' : 'Take photo'}
        </BigButton>
      </Card>

      <Card className="xl:col-start-2 xl:row-start-1">
        <h2 className="mb-2 text-lg font-bold">2. What is it? (optional)</h2>
        <div className="grid grid-cols-2 gap-2">
          {HAZARD_KEYS.map((k) => {
            const { label, Icon } = HAZARDS[k]
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

      <Card className="xl:col-start-1 xl:row-start-2">
        <h2 className="mb-2 text-lg font-bold">3. Where is the hazard?</h2>
        <div role="radiogroup" aria-label="Where is the hazard?" className="flex flex-col gap-2">
          {(
            [
              ['photo', 'Where I took the photo', photo ? (locating ? 'Saving your location...' : photoSpot ? 'Saved when you took the photo. Walking away will not move it.' : 'Your phone did not give a location. Use another choice, or the pin goes to the site center.') : 'Saved the moment you take the photo.'],
              ['now', 'Where I am now', 'Uses your location when you press send.'],
              ['map', 'Choose on the map', 'Tap the spot yourself. Best if you have already moved away.'],
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
              <Suspense fallback={<div className="flex h-72 items-center justify-center text-base">Loading map...</div>}>
                <LocationPicker siteLat={detail.site.lat} siteLon={detail.site.lon} pin={pin} onPick={(p) => {
                  setPin(p)
                  setProblem(null)
                }} onUnavailable={() => setMapBroken(true)} />
              </Suspense>
            ) : (
              <>
                <p className="mb-2 text-sm font-bold">{online ? 'The street map could not load.' : 'No signal.'} Tap this drawing of your site instead. Edge to edge is about 3,000 ft.</p>
                <PinPad site={{ lat: detail.site.lat, lon: detail.site.lon }} pin={pin} onPick={(p) => {
                  setPin(p)
                  setProblem(null)
                }} />
              </>
            )}
            <p className="mt-2 flex items-center justify-between gap-2 text-sm">
              <span data-testid="pin-status">{pin ? `Pin placed (${pin.lat}, ${pin.lon}). Drag it or tap again to move it.` : 'Tap the map where the hazard is.'}</span>
              {pin && (
                <button type="button" onClick={() => setPin(null)} className="min-h-11 rounded-lg border-2 border-input px-3 font-bold">Clear pin</button>
              )}
            </p>
          </div>
        )}
      </Card>

      <Card className="xl:col-start-2 xl:row-start-2">
        <h2 className="mb-2 text-lg font-bold">4. Note (optional)</h2>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={280}
          placeholder="Where exactly? Example: by the culvert next to pole 14"
          className="w-full rounded-lg border-2 border-input bg-card p-3 text-base"
        />
      </Card>
      </div>

      {problem && <p role="alert" className="xl:col-span-2 rounded-lg border-2 border-destructive bg-card p-3 text-base font-bold text-destructive">{problem}</p>}
      <BigButton className="xl:col-span-2" data-testid="send-report" disabled={busy} onClick={() => void send()}>
        {busy ? 'Saving...' : online ? 'Send report' : 'Save report (no signal)'}
      </BigButton>
      {!online && <p className="text-base xl:col-span-2">No signal. The report is saved on this phone and uploads on its own when signal returns.</p>}

      {queue.length > 0 && (
        <Card className="xl:col-span-2">
          <h2 className="mb-2 text-lg font-bold">Waiting to upload ({queue.length})</h2>
          <ul className="flex flex-col gap-2 text-base">
            {queue.map((q) => (
              <li key={q.client_id} className="flex items-center gap-2">
                <Clock className="h-5 w-5 shrink-0" aria-hidden />
                {q.kind === 'create_report' ? `Hazard report${q.payload.note ? `: ${q.payload.note.slice(0, 40)}` : ''}` : 'Stop-work confirmation'}
                {q.attempts > 0 && <span className="text-sm">(tried {q.attempts}x)</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Screen>
  )
}
