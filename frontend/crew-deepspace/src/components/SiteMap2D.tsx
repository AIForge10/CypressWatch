/**
 * Street map of just this site, in the same look as the supervisor app's Florida map
 * (MapLibre + OpenStreetMap tiles, round colored markers). Needs signal for the map tiles;
 * the Map tab shows the offline drawing instead when there is none.
 */
import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { RiskLevel } from '../contracts/types'
import { milesBetween, MILES_VISIBLE } from '../lib/geo'

const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    openstreetmap: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' },
  },
  layers: [{ id: 'openstreetmap', type: 'raster', source: 'openstreetmap' }],
}

export interface MapPoint {
  id: string
  lat: number
  lon: number
  label: string
  /** 'report' = numbered red circle. 'waiting' = dashed circle (not uploaded yet). */
  kind: 'report' | 'waiting'
  text: string
}

export interface SiteMap2DProps {
  name: string
  lat: number
  lon: number
  score: number
  level: RiskLevel
  points: MapPoint[]
  /** Fly to this pin and open its note. `n` changes on every request, so asking for the same pin twice works. */
  focus?: { id: string; n: number } | null
  /** Called when the map cannot load (no tiles, no WebGL), so the page can show the offline drawing. */
  onUnavailable: () => void
}

const TONE: Record<RiskLevel, string> = { low: 'success', moderate: 'warning', high: 'danger', extreme: 'danger' }
function marker(className: string, text: string, label: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = className
  el.textContent = text
  el.setAttribute('aria-label', label)
  el.addEventListener('click', (e) => {
    e.stopPropagation()
    onClick()
  })
  return el
}

export default function SiteMap2D({ name, lat, lon, score, level, points, focus, onUnavailable }: SiteMap2DProps) {
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markers = useRef<maplibregl.Marker[]>([])
  const popup = useRef<maplibregl.Popup | null>(null)
  const pins = useRef(new Map<string, { at: [number, number]; open: () => void }>())
  const failed = useRef(false)
  const failCb = useRef(onUnavailable)
  failCb.current = onUnavailable

  // Create the map once.
  useEffect(() => {
    if (!box.current) return
    let map: maplibregl.Map
    try {
      map = new maplibregl.Map({ container: box.current, style: STYLE, center: [lon, lat], zoom: 15, maxZoom: 18, attributionControl: { compact: true }, cooperativeGestures: true })
    } catch {
      failCb.current()
      return
    }
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    let tileErrors = 0
    let tileLoaded = false
    const fail = () => {
      if (failed.current) return
      failed.current = true
      failCb.current()
    }
    map.on('error', () => {
      tileErrors += 1
      if (tileErrors >= 4 && !tileLoaded) fail()
    })
    map.on('data', (e: { dataType?: string; isSourceLoaded?: boolean }) => {
      if (e.dataType === 'source' && e.isSourceLoaded) tileLoaded = true
    })
    const watchdog = setTimeout(() => {
      if (!tileLoaded) fail()
    }, 12_000)
    return () => {
      clearTimeout(watchdog)
      markers.current.forEach((m) => m.remove())
      markers.current = []
      popup.current?.remove()
      map.remove()
      mapRef.current = null
    }
    // The map is made once; later changes are handled below.
  }, [])

  // Draw the site and report markers, and frame them.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    markers.current.forEach((m) => m.remove())
    markers.current = []
    pins.current.clear()
    popup.current?.remove()
    const show = (at: [number, number], html: HTMLElement) => {
      popup.current?.remove()
      popup.current = new maplibregl.Popup({ offset: 18, closeButton: true }).setLngLat(at).setDOMContent(html).addTo(map)
    }
    const info = (title: string, lines: string[]) => {
      const d = document.createElement('div')
      d.className = 'cw-map-popup'
      const s = document.createElement('strong')
      s.textContent = title
      d.appendChild(s)
      for (const l of lines) {
        const p = document.createElement('span')
        p.textContent = l
        d.appendChild(p)
      }
      return d
    }
    const size = 28 + score * 2
    const siteEl = marker(`cw-map-marker cw-map-marker-${TONE[level]}`, score.toFixed(1), `${name}, hazard score ${score.toFixed(1)}`, () =>
      show([lon, lat], info(name, [`Hazard score ${score.toFixed(1)} of 10 · ${level}`])),
    )
    siteEl.style.width = `${size}px`
    siteEl.style.height = `${size}px`
    markers.current.push(new maplibregl.Marker({ element: siteEl, anchor: 'center' }).setLngLat([lon, lat]).addTo(map))

    const near = points.filter((p) => milesBetween(lat, lon, p.lat, p.lon) <= MILES_VISIBLE)
    for (const p of near) {
      const el = marker(`cw-map-pin ${p.kind === 'waiting' ? 'cw-map-pin-waiting' : ''}`, p.label, `${p.kind === 'waiting' ? 'Waiting to upload' : 'Report'} ${p.label}`, () =>
        show([p.lon, p.lat], info(p.kind === 'waiting' ? `Waiting to upload (${p.label})` : `Report ${p.label}`, [p.text])),
      )
      markers.current.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([p.lon, p.lat]).addTo(map))
      pins.current.set(p.id, { at: [p.lon, p.lat], open: () => show([p.lon, p.lat], info(p.kind === 'waiting' ? `Waiting to upload (${p.label})` : `Report ${p.label}`, [p.text])) })
    }
    if (near.length === 0) {
      map.easeTo({ center: [lon, lat], zoom: 15, duration: 0 })
    } else {
      const b = new maplibregl.LngLatBounds([lon, lat], [lon, lat])
      near.forEach((p) => b.extend([p.lon, p.lat]))
      map.fitBounds(b, { padding: { top: 56, left: 56, right: 56, bottom: 76 }, maxZoom: 17, duration: 0 })
    }
  }, [name, lat, lon, score, level, points])

  // A report was picked in the list: fly to it and open its note.
  useEffect(() => {
    const map = mapRef.current
    const pin = focus ? pins.current.get(focus.id) : undefined
    if (!map || !pin) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    map.flyTo({ center: pin.at, zoom: Math.max(map.getZoom(), 17), duration: reduce ? 0 : 900, essential: true })
    pin.open()
    // Only a new request (focus.n) counts, not later redraws of the same points.
  }, [focus?.n])

  return <div ref={box} className="cw-interactive-map h-80 w-full xl:h-[26rem] overflow-hidden rounded-lg" aria-label={`Street map of ${name} and hazard reports near it`} />
}
