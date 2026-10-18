/**
 * "Display" button and panel: font, text size and spacing for people who read better with other settings
 * (dyslexia, low vision, tired eyes). One size does not fit all, so the font is a choice, not a switch.
 * Reading settings only. Sign out lives in the top bar, always visible.
 */
import { useEffect, useRef, useState } from 'react'
import { Type } from 'lucide-react'
import { cn } from '../lib/utils'
import { FONTS, useReading, type SizeChoice } from '../lib/reading'
import { FONT_NOTE_KEY, useT } from '../lib/i18n'

const SIZES: { id: SizeChoice; label: 'disp.md' | 'disp.lg' | 'disp.xl' }[] = [
  { id: 'md', label: 'disp.md' },
  { id: 'lg', label: 'disp.lg' },
  { id: 'xl', label: 'disp.xl' },
]

function Switch({ on, onChange, label, hint }: { on: boolean; onChange: () => void; label: string; hint: string }) {
  const { t } = useT()
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onChange}
      className="flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border-2 border-border bg-card px-3 py-2 text-left"
    >
      <span>
        <span className="block font-bold">{label}</span>
        <span className="block text-sm text-muted-foreground">{hint}</span>
      </span>
      <span className={cn('flex h-7 w-12 shrink-0 items-center rounded-full border-2 px-0.5', on ? 'justify-end border-primary bg-primary' : 'justify-start border-input bg-card')} aria-hidden>
        <span className={cn('h-5 w-5 rounded-full', on ? 'bg-white' : 'bg-input')} />
      </span>
      <span className="sr-only">{on ? t('switch.on') : t('switch.off')}</span>
    </button>
  )
}

export default function DisplayMenu() {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [reading, change, reset] = useReading()
  const box = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        button.current?.focus()
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  const family = FONTS.find((f) => f.id === reading.font) ?? FONTS[0]

  return (
    <div ref={box}>
      <button
        ref={button}
        type="button"
        data-testid="display-toggle"
        aria-expanded={open}
        aria-controls="display-panel"
        aria-label={t('disp.label')}
        title={t('disp.label')}
        onClick={() => setOpen((o) => !o)}
        className={cn('flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-bold', open ? 'border-white bg-white text-brand-strong' : 'border-[#5a5a55] text-[#e3eeee] hover:bg-[#4a4a45]')}
      >
        <Type className="h-5 w-5" aria-hidden />
        <span className="hidden md:inline">{t('disp.button')}</span>
      </button>
      {open && (
        <div
          id="display-panel"
          role="dialog"
          aria-label={t('disp.dialog')}
          data-testid="display-panel"
          className="absolute right-3 top-full z-50 mt-2 sm:right-6 lg:right-8 max-h-[calc(100dvh-6rem)] w-[min(24rem,calc(100vw-1.5rem))] space-y-4 overflow-y-auto rounded-xl border-2 border-border bg-card p-4 text-card-foreground shadow-lg"
        >
          <div>
            <label htmlFor="font-choice" className="mb-1 block font-bold">{t('disp.font')}</label>
            <select
              id="font-choice"
              data-testid="font-choice"
              value={reading.font}
              onChange={(e) => change({ font: e.target.value as typeof reading.font })}
              className="min-h-14 w-full rounded-lg border-2 border-input bg-card px-3 text-base"
            >
              {FONTS.map((f) => (
                <option key={f.id} value={f.id}>{f.id === 'standard' ? t('font.standard.label') : f.label}</option>
              ))}
            </select>
            <p className="mt-1 text-sm text-muted-foreground">{t(FONT_NOTE_KEY[family.id])}</p>
            <p data-testid="font-preview" className="mt-2 rounded-lg border-2 border-border bg-secondary p-3" style={{ fontFamily: family.family }}>
              <span className="block font-bold">{t('disp.sample1')}</span>
              <span className="block">{t('disp.sample2')}</span>
            </p>
          </div>

          <div role="group" aria-labelledby="size-label">
            <p id="size-label" className="mb-1 font-bold">{t('disp.size')}</p>
            <div className="grid grid-cols-3 gap-2">
              {SIZES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={reading.size === s.id}
                  onClick={() => change({ size: s.id })}
                  className={cn('min-h-12 rounded-lg border-2 px-2 font-bold', reading.size === s.id ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card')}
                >
                  {t(s.label)}
                </button>
              ))}
            </div>
          </div>

          <Switch
            on={reading.spacing === 'wide'}
            onChange={() => change({ spacing: reading.spacing === 'wide' ? 'normal' : 'wide' })}
            label={t('disp.spacing')}
            hint={t('disp.spacingHint')}
          />

          <div className="flex gap-2">
            <button type="button" onClick={reset} className="min-h-12 flex-1 rounded-lg border-2 border-input bg-card px-3 font-bold">
              {t('disp.reset')}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="min-h-12 flex-1 rounded-lg bg-primary px-3 font-bold text-primary-foreground">
              {t('disp.done')}
            </button>
          </div>

        </div>
      )}
    </div>
  )
}
