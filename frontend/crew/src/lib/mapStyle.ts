import type { StyleSpecification } from 'maplibre-gl'

/** OpenStreetMap tiles, the same source the supervisor app uses. */
export const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    openstreetmap: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' },
  },
  layers: [{ id: 'openstreetmap', type: 'raster', source: 'openstreetmap' }],
}
