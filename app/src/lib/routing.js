/*
 * routing.js — trazar la ruta de tu ubicación a un lugar favorito.
 *
 * Con internet: usa OSRM (calles reales, distancia por carretera).
 * Sin internet: cae a una línea directa con distancia en línea recta.
 *
 * (La navegación giro-a-giro offline real requiere un motor pesado; esto es
 * lo razonable para el uso en moto: ver hacia dónde ir y cuánto falta.)
 */
import { haversineKm } from './store'

const OSRM = 'https://router.project-osrm.org/route/v1/driving'

export async function getRoute(from, to) {
  // from/to: { lat, lon }
  const straight = {
    coords: [
      [from.lon, from.lat],
      [to.lon, to.lat],
    ],
    distanceKm: Math.round(haversineKm(from, to) * 100) / 100,
    online: false,
  }

  try {
    const url = `${OSRM}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 6000)
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) return straight
    const d = await res.json()
    const r = d.routes && d.routes[0]
    if (!r || !r.geometry) return straight
    return {
      coords: r.geometry.coordinates, // [[lon,lat], ...]
      distanceKm: Math.round((r.distance / 1000) * 100) / 100,
      durationMin: Math.round(r.duration / 60),
      online: true,
    }
  } catch {
    return straight // offline o error → línea directa
  }
}
