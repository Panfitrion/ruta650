/*
 * routines.js — "aprende" tus rutas y rutinas, 100% en el teléfono.
 *
 * No es IA: son estadísticas simples sobre tu propio historial de viajes.
 *  1) discoverFrequentPlaces(): detecta lugares a los que vas seguido y aún
 *     no guardaste, agrupando dónde terminan tus viajes.
 *  2) suggestDestination(now, pos): predice a qué favorito sueles ir a esta
 *     hora/día, para sugerirlo en el tablero.
 *
 * Nada sale del teléfono. Necesita algunos viajes grabados para ser útil.
 */
import { haversineKm, getTripsRaw, getPlaces } from './store'

const NEAR_KM = 0.2 // "estás/terminaste aquí" si estás a <200 m
const CLUSTER_KM = 0.15 // radio para agrupar destinos repetidos
const MIN_VISITS_DISCOVER = 3 // visitas para sugerir guardar un lugar
const MIN_SCORE_SUGGEST = 2 // confianza mínima para sugerir destino

function tripEnd(t) {
  return t.points && t.points.length ? t.points[t.points.length - 1] : null
}
function tripStartDate(t) {
  const ts = t.started_at || (t.points && t.points[0] && t.points[0].t)
  return ts ? new Date(ts * 1000) : null
}
function centroid(pts) {
  const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length
  const lon = pts.reduce((s, p) => s + p.lon, 0) / pts.length
  return { lat, lon }
}

// --- 1) Descubrir lugares frecuentes aún no guardados ---
export function discoverFrequentPlaces() {
  const places = getPlaces()
  const trips = getTripsRaw()
  const ends = trips.map(tripEnd).filter(Boolean)
  // quitar los que ya son (o están cerca de) un favorito
  const fresh = ends.filter((e) => !places.some((p) => haversineKm(e, p) < NEAR_KM))

  const clusters = []
  for (const e of fresh) {
    let c = clusters.find((cl) => haversineKm(cl.center, e) < CLUSTER_KM)
    if (c) {
      c.points.push(e)
      c.center = centroid(c.points)
    } else {
      clusters.push({ center: { lat: e.lat, lon: e.lon }, points: [e] })
    }
  }
  return clusters
    .filter((c) => c.points.length >= MIN_VISITS_DISCOVER)
    .map((c) => ({ lat: c.center.lat, lon: c.center.lon, visits: c.points.length }))
    .sort((a, b) => b.visits - a.visits)
}

// ¿En qué lugar guardado estás ahora? (o null si no estás en ninguno)
function placeAt(pos, places) {
  if (!pos) return null
  for (const p of places) {
    if (haversineKm(pos, p) < NEAR_KM) return p
  }
  return null
}

// --- 2) Sugerir destino según ORIGEN + hora/día (rutina direccional) ---
// Aprende pares "de A → a B": si estás en el trabajo a las 6pm, sugiere casa;
// si estás en casa a las 8am, sugiere trabajo. Si no está seguro de dónde
// estás, cae a la lógica por hora/día solamente.
export function suggestDestination(now = new Date(), currentPos = null) {
  const places = getPlaces()
  if (!places.length) return null
  const trips = getTripsRaw()
  if (trips.length < 3) return null // aún no hay datos suficientes

  const nowH = now.getHours()
  const nowD = now.getDay()
  const nowIsWeekend = nowD === 0 || nowD === 6
  const origin = placeAt(currentPos, places) // dónde estás ahora (si es un favorito)

  let best = null
  for (const dest of places) {
    if (origin && dest.id === origin.id) continue // no sugerir el lugar donde ya estás
    if (!origin && currentPos && haversineKm(currentPos, dest) < NEAR_KM) continue

    let score = 0
    let visits = 0
    for (const t of trips) {
      const end = tripEnd(t)
      if (!end || haversineKm(end, dest) > NEAR_KM) continue // no terminó en este destino

      // Si sabemos dónde estás, solo cuentan los viajes que SALIERON de ahí.
      // Así aprende la dirección: trabajo→casa es distinto de casa→trabajo.
      if (origin) {
        const start = t.points && t.points[0]
        if (!start || haversineKm(start, origin) > NEAR_KM) continue
      }

      const d = tripStartDate(t)
      if (!d) continue
      visits++
      const diff = Math.abs(d.getHours() - nowH)
      const hourDiff = Math.min(diff, 24 - diff)
      if (hourDiff <= 2) {
        let w = 1
        if (d.getDay() === nowD) w += 2 // mismo día de la semana
        else if ((d.getDay() === 0 || d.getDay() === 6) === nowIsWeekend) w += 0.5
        if (origin) w += 2 // coincide el origen: rutina direccional, señal fuerte
        score += w
      }
    }
    if (visits > 0 && score > (best ? best.score : 0)) {
      best = { place: dest, score, visits, from: origin }
    }
  }
  if (best && best.score >= MIN_SCORE_SUGGEST) return best
  return null
}
