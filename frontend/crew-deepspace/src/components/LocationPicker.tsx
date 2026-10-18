/**
 * Tap the street map to place the hazard pin. Needs signal for the map tiles;
 * the report form shows a simple drawing instead when there is none.
 */
import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MAP_STYLE } from '../lib/mapStyle'
import { useT } from '../lib/i18n'

export interface Pin {
  lat: number
  lon: number
}

export default function LocationPicker({ siteLat, siteLon, pin, onPick, onUnavailable }: { siteLat: number; siteLon: number; pin: Pin | null; onPick: (p: Pin) => void; onUnavailable: () => void }) {
  const { t } = useT()
  const tRef = useRef(t)
  tRef.current = t
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const marker = useRef<maplibregl.Marker | null>(null)
  const pick = useRef(onPick)
  pick.current = onPick
  const fail = useRef(onUnavailable)
  fail.current = onUnavailable
  const start = useRef({ lat: pin?.lat ?? siteLat, lon: pin?.lon ?? siteLon })

  useEffect(() => {
    if (!box.current) return
    let map: maplibregl.Map
    try {
      map = new maplibregl.Map({ container: box.current, style: MAP_STYLE, center: [start.current.lon, start.current.lat], zoom: 16, maxZoom: 19, attributionControl: { compact: true } })
    } catch {
      fail.current()
      return
    }
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    // The site itself, so people can find their way around.
    const siteEl = document.createElement('div')
    siteEl.className = 'cw-pick-site'
    siteEl.setAttribute('aria-label', tRef.current('rep.pickerCenter'))
    new maplibregl.Marker({ element: siteEl, anchor: 'center' }).setLngLat([siteLon, siteLat]).addTo(map)
    const place = (lat: number, lon: number) => {
      const p = { lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)) }
      if (!marker.current) {
        const el = document.createElement('div')
        el.className = 'cw-pick-pin'
        el.setAttribute('aria-label', tRef.current('rep.pickerPin'))
        marker.current = new maplibregl.Marker({ element: el, anchor: 'center', draggable: true }).setLngLat([p.lon, p.lat]).addTo(map)
        marker.current.on('dragend', () => {
          const ll = marker.current!.getLngLat()
          pick.current({ lat: Number(ll.lat.toFixed(5)), lon: Number(ll.lng.toFixed(5)) })
        })
      } else marker.current.setLngLat([p.lon, p.lat])
      pick.current(p)
    }
    map.on('click', (e) => place(e.lngLat.lat, e.lngLat.lng))
    if (pin) place(pin.lat, pin.lon)
    let tileErrors = 0
    let tileLoaded = false
    map.on('error', () => {
      tileErrors += 1
      if (tileErrors >= 4 && !tileLoaded) fail.current()
    })
    map.on('data', (e: { dataType?: string; isSourceLoaded?: boolean }) => {
      if (e.dataType === 'source' && e.isSourceLoaded) tileLoaded = true
    })
    const watchdog = setTimeout(() => {
      if (!tileLoaded) fail.current()
    }, 12_000)
    return () => {
      clearTimeout(watchdog)
      marker.current?.remove()
      marker.current = null
      map.remove()
      mapRef.current = null
    }
    // Made once; the pin is only read at the start.
  }, [])

  // The pin was cleared from outside.
  useEffect(() => {
    if (!pin && marker.current) {
      marker.current.remove()
      marker.current = null
    }
  }, [pin])

  return <div ref={box} className="cw-interactive-map h-72 w-full overflow-hidden rounded-lg" aria-label={t('rep.pickerLabel')} />
}
