import { useEffect, useRef, useState } from 'react'
import { Camera, Check, CircleCheck, Clock, MapPin } from 'lucide-react'
import { Screen, Card, BigButton, Message } from '../../components/ui-bits'
import { HAZARDS, HAZARD_KEYS } from '../../lib/hazards'
import { useCrew } from '../../lib/crewData'
import { useFreshness } from '../../lib/freshness'
import { cn } from '../../lib/utils'
import type { HazardKey } from '../../contracts/types'

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

  useEffect(() => {
    if (!photo) return setPreview(null)
    const url = URL.createObjectURL(photo)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])

  if (!detail || !me) {
    return (
      <Screen title="Report a hazard">
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
    const [blob, pos] = await Promise.all([shrink(photo), getPosition()])
    const where = pos ?? { lat: detail.site.lat, lon: detail.site.lon }
    await submitReport(
      {
        site_id: detail.site.site_id,
        lat: where.lat,
        lon: where.lon,
        note: pos ? note.trim() : `${note.trim()} (Pin placed at site center: phone location was not available.)`.trim(),
        reporter_hazard: hazard,
      },
      blob,
    )
    setBusy(false)
    setDone(wasOnline ? 'sent' : 'saved')
    setPhoto(null)
    setHazard(null)
    setNote('')
  }

  return (
    <Screen title="Report a hazard">
      {done && (
        <p role="status" data-testid="report-done" className="flex items-start gap-2 rounded-xl border-2 border-[#14663a] bg-[#d6efdf] p-4 text-lg font-bold">
          {done === 'sent' ? <CircleCheck className="mt-0.5 h-6 w-6 shrink-0" aria-hidden /> : <Clock className="mt-0.5 h-6 w-6 shrink-0" aria-hidden />}
          {done === 'sent' ? 'Report sent to your team.' : 'Saved on this phone. It uploads on its own when signal returns.'}
        </p>
      )}

      <Card>
        <h2 className="mb-2 text-lg font-bold">1. Photo</h2>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Take or choose a photo" data-testid="photo-input" onChange={(e) => { setPhoto(e.target.files?.[0] ?? null); setDone(null) }} />
        {preview && <img src={preview} alt="Photo of the hazard you will report" className="mb-3 max-h-64 w-full rounded-lg object-cover" />}
        <BigButton onClick={() => fileRef.current?.click()}>
          <Camera className="h-6 w-6" aria-hidden /> {photo ? 'Retake photo' : 'Take photo'}
        </BigButton>
      </Card>

      <Card>
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
                className={cn('flex min-h-14 items-center gap-2 rounded-xl border-2 px-3 text-base font-bold', on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card')}
              >
                {on ? <Check className="h-5 w-5" aria-hidden /> : <Icon className="h-5 w-5" aria-hidden />}
                {label}
              </button>
            )
          })}
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-bold">3. Note (optional)</h2>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={280}
          placeholder="Where exactly? Example: by the culvert next to pole 14"
          className="w-full rounded-xl border-2 border-border bg-card p-3 text-base"
        />
        <p className="mt-2 flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4" aria-hidden /> The pin uses your phone&apos;s location when you send.
        </p>
      </Card>

      {problem && <p role="alert" className="rounded-xl border-2 border-destructive bg-card p-3 text-base font-bold text-destructive">{problem}</p>}
      <BigButton data-testid="send-report" disabled={busy} onClick={() => void send()}>
        {busy ? 'Saving...' : online ? 'Send report' : 'Save report (no signal)'}
      </BigButton>
      {!online && <p className="text-base">No signal. The report is saved on this phone and uploads on its own when signal returns.</p>}

      {queue.length > 0 && (
        <Card>
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
