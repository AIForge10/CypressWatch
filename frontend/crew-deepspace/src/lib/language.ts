/** Which language the briefing is shown in. Saved on this phone; English until someone picks Spanish. */
import { useCallback, useState } from 'react'

export type Lang = 'en' | 'es'
const KEY = 'cw:lang'

export function useLanguage(): [Lang, () => void] {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      return localStorage.getItem(KEY) === 'es' ? 'es' : 'en'
    } catch {
      return 'en'
    }
  })
  const toggle = useCallback(() => {
    setLang((l) => {
      const next: Lang = l === 'es' ? 'en' : 'es'
      try {
        localStorage.setItem(KEY, next)
      } catch {
        /* storage blocked: it still works until the page is closed */
      }
      return next
    })
  }, [])
  return [lang, toggle]
}
