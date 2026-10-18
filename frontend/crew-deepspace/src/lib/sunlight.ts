/**
 * Sunlight mode: a high-contrast look for reading the screen outdoors in bright sun.
 * Switching it sets <html data-contrast="high">, and themes.css restyles the whole app from that.
 * The choice is saved on this phone. If the person never chose, it follows the phone's own
 * "increase contrast" setting.
 */
import { useCallback, useEffect, useState } from 'react'

const KEY = 'cw:sunlight'

function saved(): 'on' | 'off' | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'on' || v === 'off' ? v : null
  } catch {
    return null
  }
}

function phoneWantsContrast(): boolean {
  try {
    return window.matchMedia('(prefers-contrast: more)').matches
  } catch {
    return false
  }
}

export function useSunlight(): [boolean, () => void] {
  const [on, setOn] = useState<boolean>(() => {
    const s = saved()
    return s ? s === 'on' : phoneWantsContrast()
  })
  useEffect(() => {
    if (on) document.documentElement.setAttribute('data-contrast', 'high')
    else document.documentElement.removeAttribute('data-contrast')
  }, [on])
  const toggle = useCallback(() => {
    setOn((v) => {
      try {
        localStorage.setItem(KEY, v ? 'off' : 'on')
      } catch {
        /* storage blocked: it still works until the page is closed */
      }
      return !v
    })
  }, [])
  return [on, toggle]
}
