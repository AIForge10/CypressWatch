/**
 * Which language the whole app is shown in. Saved on this phone.
 * If nobody ever chose, it follows the phone's own language (Spanish phones start in Spanish).
 * One shared value: the header button, the briefing and every screen change together.
 */
import { useCallback, useSyncExternalStore } from 'react'

export type Lang = 'en' | 'es'
const KEY = 'cw:lang'

function initial(): Lang {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'es' || v === 'en') return v
  } catch {
    /* storage blocked */
  }
  try {
    return navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en'
  } catch {
    return 'en'
  }
}

let current: Lang | null = null
const listeners = new Set<() => void>()

function get(): Lang {
  if (current === null) current = initial()
  return current
}

function applyToPage(l: Lang) {
  try {
    document.documentElement.setAttribute('lang', l)
  } catch {
    /* no document */
  }
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  applyToPage(get())
  return () => {
    listeners.delete(fn)
  }
}

export function setLanguage(next: Lang) {
  current = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    /* storage blocked: it still works until the page is closed */
  }
  applyToPage(next)
  listeners.forEach((f) => f())
}

export function useLanguage(): [Lang, () => void] {
  const lang = useSyncExternalStore(subscribe, get, () => 'en' as Lang)
  const toggle = useCallback(() => setLanguage(get() === 'es' ? 'en' : 'es'), [])
  return [lang, toggle]
}
