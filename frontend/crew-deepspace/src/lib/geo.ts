/** Small distance helpers for the site map. */
export const MILES_VISIBLE = 2 // pins farther than this from the site are not drawn on the street map

export function milesBetween(aLat: number, aLon: number, bLat: number, bLon: number) {
  const k = Math.cos((aLat * Math.PI) / 180)
  return Math.hypot((bLat - aLat) * 69, (bLon - aLon) * 69 * k)
}
