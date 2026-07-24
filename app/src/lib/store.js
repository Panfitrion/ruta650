/*
 * store.js — "cerebro" de la app, 100% en el teléfono (sin backend).
 *
 * Reemplaza al servidor Python: toda la lógica (gasolina brim-to-brim,
 * lugares, viajes, odómetro GPS) corre aquí y persiste en localStorage del
 * propio iPhone. Así la app funciona sola, sin Mac ni internet.
 */

// --- Persistencia base ---
const K = {
  fuelState: 're650.fuelState',
  fuelLog: 're650.fuelLog',
  places: 're650.places',
  trips: 're650.trips',
}

function read(key, def) {
  try {
    const v = localStorage.getItem(key)
    return v ? JSON.parse(v) : def
  } catch {
    return def
  }
}
function write(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val))
  } catch (e) {
    console.warn('store: no se pudo guardar', key, e)
  }
}
function uid() {
  return Math.random().toString(36).slice(2, 10)
}

// --- Geo ---
export function haversineKm(a, b) {
  const R = 6371
  const p1 = (a.lat * Math.PI) / 180
  const p2 = (b.lat * Math.PI) / 180
  const dp = ((b.lat - a.lat) * Math.PI) / 180
  const dl = ((b.lon - a.lon) * Math.PI) / 180
  const x =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(x))
}
function routeDistanceKm(points) {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += haversineKm(points[i - 1], points[i])
  }
  return total
}

// =====================================================================
// GASOLINA (método brim-to-brim + ajuste por velocidad)
// =====================================================================
export const TANK_CAPACITY_L = 15.7 // Super Meteor 650
export const DEFAULT_L_100KM = 4.5
export const REF_SPEED_KMH = 60
export const DRAG_K = 0.45

function defaultFuelState() {
  return {
    odometer_km: 0,
    last_fill_odo: null,
    last_fill_level_l: null,
    tank_capacity_l: TANK_CAPACITY_L,
  }
}
function fuelState() {
  return read(K.fuelState, defaultFuelState())
}
function fuelLog() {
  return read(K.fuelLog, [])
}

export function speedFactor(vKmh) {
  if (!vKmh || vKmh <= 0) return 1
  const ref = Math.max(1, REF_SPEED_KMH)
  const raw = (1 + DRAG_K * (vKmh / ref) ** 2) / (1 + DRAG_K)
  return Math.max(0.6, Math.min(1.8, raw))
}

function economyLPerKm(log) {
  const fulls = log
    .filter((f) => f.full && f.odo_km != null)
    .sort((a, b) => a.odo_km - b.odo_km)
  let totalL = 0
  let totalKm = 0
  for (let i = 1; i < fulls.length; i++) {
    const km = fulls[i].odo_km - fulls[i - 1].odo_km
    const liters = fulls[i].liters || 0
    if (km > 0 && liters > 0) {
      totalKm += km
      totalL += liters
    }
  }
  if (totalKm > 0 && totalL > 0) return [totalL / totalKm, true]
  return [DEFAULT_L_100KM / 100, false]
}

export function addDistance(kmDelta) {
  if (!kmDelta || kmDelta <= 0) return fuelState().odometer_km
  const st = fuelState()
  st.odometer_km = Math.round((st.odometer_km + kmDelta) * 10000) / 10000
  write(K.fuelState, st)
  return st.odometer_km
}
export function getOdometer() {
  return fuelState().odometer_km
}

export function addFillup({ liters, full = true, cost = null, odo_km = null }) {
  const st = fuelState()
  const log = fuelLog()
  const now = Date.now() / 1000
  const odo = odo_km != null ? odo_km : st.odometer_km
  const [economy] = economyLPerKm(log)
  const cap = st.tank_capacity_l ?? TANK_CAPACITY_L

  let levelBefore = 0
  if (st.last_fill_level_l != null && st.last_fill_odo != null) {
    const consumed = Math.max(0, (odo - st.last_fill_odo) * economy)
    levelBefore = Math.max(0, st.last_fill_level_l - consumed)
  }
  const levelAfter = full ? cap : Math.min(cap, levelBefore + liters)

  const entry = {
    id: uid(),
    t: now,
    liters: Math.round(liters * 1000) / 1000,
    full: !!full,
    cost: cost != null ? Math.round(cost * 100) / 100 : null,
    odo_km: Math.round(odo * 1000) / 1000,
    level_after_l: Math.round(levelAfter * 1000) / 1000,
  }
  log.push(entry)
  write(K.fuelLog, log)

  st.last_fill_odo = odo
  st.last_fill_level_l = levelAfter
  write(K.fuelState, st)
  return entry
}

export function getFuelLog() {
  return fuelLog().sort((a, b) => (b.t || 0) - (a.t || 0))
}
export function deleteFillup(id) {
  const log = fuelLog()
  const next = log.filter((f) => f.id !== id)
  if (next.length === log.length) return false
  write(K.fuelLog, next)
  return true
}
export function setCapacity(liters) {
  const st = fuelState()
  st.tank_capacity_l = liters
  write(K.fuelState, st)
  return fuelStatus()
}

export function fuelStatus(speedKmh = null) {
  const st = fuelState()
  const log = fuelLog()
  const [economy, real] = economyLPerKm(log)
  const odo = st.odometer_km
  const cap = st.tank_capacity_l ?? TANK_CAPACITY_L

  let current = null
  let kmSinceFill = null
  if (st.last_fill_level_l != null && st.last_fill_odo != null) {
    const consumed = Math.max(0, (odo - st.last_fill_odo) * economy)
    current = Math.max(0, st.last_fill_level_l - consumed)
    kmSinceFill = Math.round((odo - st.last_fill_odo) * 100) / 100
  }

  const l100 = Math.round(economy * 100 * 100) / 100
  const kmPerL = economy > 0 ? Math.round((1 / economy) * 100) / 100 : null
  const rangeKm =
    current != null && economy > 0 ? Math.round((current / economy) * 10) / 10 : null

  const costs = log.filter((f) => f.cost && f.liters)
  const pricePerL = costs.length
    ? Math.round(
        (costs.reduce((s, f) => s + f.cost, 0) / costs.reduce((s, f) => s + f.liters, 0)) * 100
      ) / 100
    : null
  const costPerKm = pricePerL ? Math.round(pricePerL * economy * 100) / 100 : null

  const out = {
    tank_capacity_l: cap,
    current_fuel_l: current != null ? Math.round(current * 100) / 100 : null,
    tank_pct: current != null ? Math.round((current / cap) * 100) : null,
    range_km: rangeKm,
    km_since_fill: kmSinceFill,
    l_per_100km: l100,
    km_per_l: kmPerL,
    economy_is_real: real,
    price_per_l: pricePerL,
    cost_per_km: costPerKm,
    odometer_km: Math.round(odo * 100) / 100,
    fill_count: log.length,
    ref_speed_kmh: REF_SPEED_KMH,
  }
  if (speedKmh && speedKmh > 0) {
    const f = speedFactor(speedKmh)
    const ecoAdj = economy * f
    out.speed_kmh = Math.round(speedKmh * 10) / 10
    out.speed_factor = Math.round(f * 1000) / 1000
    out.l_per_100km_now = Math.round(ecoAdj * 100 * 100) / 100
    out.range_km_now =
      current != null && ecoAdj > 0 ? Math.round((current / ecoAdj) * 10) / 10 : null
  }
  return out
}

// =====================================================================
// LUGARES FRECUENTES
// =====================================================================
export function getPlaces() {
  return read(K.places, [])
}
export function addPlace({ name, lat, lon, category = 'otro' }) {
  const places = getPlaces()
  const place = { id: uid(), name, lat, lon, category, created_at: Date.now() / 1000 }
  places.push(place)
  write(K.places, places)
  return place
}
export function deletePlace(id) {
  const places = getPlaces()
  const next = places.filter((p) => p.id !== id)
  write(K.places, next)
  return next.length !== places.length
}

// Importa lugares desde un enlace (sin duplicar por nombre). Devuelve cuántos añadió.
// Sirve para precargar tus lugares SIN meterlos en el código público.
export function importPlaces(list) {
  if (!Array.isArray(list)) return 0
  const places = getPlaces()
  let added = 0
  for (const p of list) {
    if (!p || p.lat == null || p.lon == null || !p.name) continue
    const dup = places.some((q) => q.name.toLowerCase() === String(p.name).toLowerCase())
    if (dup) continue
    places.push({
      id: uid(),
      name: String(p.name),
      lat: Number(p.lat),
      lon: Number(p.lon),
      category: p.category || 'otro',
      created_at: Date.now() / 1000,
    })
    added++
  }
  if (added) write(K.places, places)
  return added
}

// =====================================================================
// VIAJES (rutas GPS)
// =====================================================================
// Viajes completos, con puntos GPS (para el motor de rutinas)
export function getTripsRaw() {
  return read(K.trips, [])
}

export function getTrips() {
  const trips = read(K.trips, [])
  const summary = {
    total_km: Math.round(trips.reduce((s, t) => s + (t.km || 0), 0) * 100) / 100,
    trip_count: trips.length,
  }
  // Sin los puntos para la lista (más liviano)
  const list = trips
    .map(({ points, ...rest }) => rest)
    .sort((a, b) => (b.started_at || 0) - (a.started_at || 0))
  return { trips: list, summary }
}
export function saveTrip({ points, name = '', started_at = null, ended_at = null }) {
  if (!points || points.length < 2) return { ok: false, error: 'ruta muy corta' }
  const trips = read(K.trips, [])
  const km = Math.round(routeDistanceKm(points) * 1000) / 1000
  const trip = {
    id: uid(),
    name,
    started_at: started_at ?? points[0].t,
    ended_at: ended_at ?? points[points.length - 1].t,
    km,
    point_count: points.length,
    points,
    created_at: Date.now() / 1000,
  }
  trips.push(trip)
  write(K.trips, trips)
  const { points: _p, ...summary } = trip
  return { ok: true, trip: summary }
}
export function deleteTrip(id) {
  const trips = read(K.trips, [])
  const next = trips.filter((t) => t.id !== id)
  write(K.trips, next)
  return next.length !== trips.length
}
