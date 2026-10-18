/**
 * Reading settings: font, text size and spacing. Saved on this phone.
 * They are applied as attributes on <html> (data-font, data-size, data-spacing) and themes.css does the rest.
 * index.html sets the same attributes before the page paints, so there is no flash of the standard look.
 */
import { useCallback, useEffect, useState } from 'react'

export type FontChoice = 'standard' | 'atkinson' | 'lexend' | 'opendyslexic' | 'verdana'
export type SizeChoice = 'md' | 'lg' | 'xl'
export interface Reading {
  font: FontChoice
  size: SizeChoice
  /** Wide: more room between lines, letters and words, and no all-capital labels. */
  spacing: 'normal' | 'wide'
}

export const DEFAULT_READING: Reading = { font: 'standard', size: 'md', spacing: 'normal' }
const KEY = 'cw:reading'

export const FONTS: { id: FontChoice; label: string; note: string; family: string }[] = [
  { id: 'standard', label: 'Standard (Open Sans)', note: 'The look of the rest of CypressWatch.', family: '"Open Sans", ui-sans-serif, system-ui, sans-serif' },
  { id: 'atkinson', label: 'Atkinson Hyperlegible', note: 'Letters that look alike are drawn differently.', family: '"Atkinson Hyperlegible", ui-sans-serif, system-ui, sans-serif' },
  { id: 'lexend', label: 'Lexend', note: 'Wide, even letters that are easy to follow.', family: 'Lexend, ui-sans-serif, system-ui, sans-serif' },
  { id: 'opendyslexic', label: 'OpenDyslexic', note: 'Heavy bottoms on letters so they do not flip.', family: 'OpenDyslexic, ui-sans-serif, system-ui, sans-serif' },
  { id: 'verdana', label: 'Verdana', note: 'Roomy and plain. Uses the phone font if Verdana is missing.', family: 'Verdana, Tahoma, ui-sans-serif, system-ui, sans-serif' },
]

function read(): Reading {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Reading>
    return {
      font: FONTS.some((f) => f.id === p.font) ? (p.font as FontChoice) : 'standard',
      size: p.size === 'lg' || p.size === 'xl' ? p.size : 'md',
      spacing: p.spacing === 'wide' ? 'wide' : 'normal',
    }
  } catch {
    return DEFAULT_READING
  }
}

function apply(r: Reading) {
  const el = document.documentElement
  const set = (name: string, value: string | null) => (value ? el.setAttribute(name, value) : el.removeAttribute(name))
  set('data-font', r.font === 'standard' ? null : r.font)
  set('data-size', r.size === 'md' ? null : r.size)
  set('data-spacing', r.spacing === 'wide' ? 'wide' : null)
}

export function useReading(): [Reading, (patch: Partial<Reading>) => void, () => void] {
  const [reading, setReading] = useState<Reading>(read)
  useEffect(() => apply(reading), [reading])
  const change = useCallback((patch: Partial<Reading>) => {
    setReading((r) => {
      const next = { ...r, ...patch }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        /* storage blocked: it still works until the page is closed */
      }
      return next
    })
  }, [])
  const reset = useCallback(() => change(DEFAULT_READING), [change])
  return [reading, change, reset]
}
