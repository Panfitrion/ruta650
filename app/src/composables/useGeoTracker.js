import { ref, computed, onMounted, onUnmounted } from 'vue'
import { haversineKm, saveTrip as storeSaveTrip } from '../lib/store'

/**
 * Rastrea la posición GPS del teléfono (navigator.geolocation).
 *
 * La ubicación se sigue SIEMPRE (para mostrar el punto azul al abrir el mapa).
 * La distancia y la ruta solo se acumulan cuando `tracking` está activo
 * (al presionar "Grabar ruta").
 *
 * Funciona SIN internet: el GPS no necesita datos.
 */
export function useGeoTracker() {
  const supported = 'geolocation' in navigator
  const tracking = ref(false)
  const position = ref(null) // {lat, lon, accuracy, speed}
  const route = ref([]) // [{lat, lon, t}]
  const distanceKm = ref(0)
  const maxSpeedKmh = ref(0)
  const error = ref(null)
  const startedAt = ref(null)

  let watchId = null
  const MIN_STEP_KM = 0.008
  const MAX_ACCURACY_M = 50

  function onPos(pos) {
    const { latitude, longitude, accuracy, speed } = pos.coords
    position.value = { lat: latitude, lon: longitude, accuracy, speed }

    // Solo acumulamos ruta/distancia mientras grabamos.
    if (!tracking.value) return
    // Velocidad máxima del viaje (desde el GPS)
    if (speed != null && speed >= 0) {
      const kmh = Math.round(speed * 3.6)
      if (kmh > maxSpeedKmh.value) maxSpeedKmh.value = kmh
    }
    if (accuracy != null && accuracy > MAX_ACCURACY_M) return

    const pt = { lat: latitude, lon: longitude, t: Date.now() / 1000 }
    const last = route.value[route.value.length - 1]
    if (!last) {
      route.value.push(pt)
      return
    }
    const step = haversineKm(last, pt)
    if (step >= MIN_STEP_KM) {
      distanceKm.value += step
      route.value.push(pt)
    }
  }

  function onErr(err) {
    error.value = err.message || 'Error de GPS'
  }

  function startWatch() {
    if (!supported || watchId != null) return
    watchId = navigator.geolocation.watchPosition(onPos, onErr, {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 15000,
    })
  }

  function start() {
    // Empezar a GRABAR una ruta (la ubicación ya se sigue desde el montaje).
    if (!supported) return
    error.value = null
    route.value = []
    distanceKm.value = 0
    maxSpeedKmh.value = 0
    startedAt.value = Date.now() / 1000
    tracking.value = true
    startWatch()
  }

  function stop() {
    // Detener la grabación (seguimos mostrando ubicación).
    tracking.value = false
  }

  // Simula una ruta por CDMX (para probar sin salir a manejar).
  // Reproduce puntos sintéticos como si fueran del GPS. Devuelve una promesa
  // que se resuelve al terminar la reproducción.
  function simulate() {
    return new Promise((resolve) => {
      const N = 45
      const durationS = 14 * 60 // fingir un viaje de ~14 min
      const fakeStart = Date.now() / 1000 - durationS
      let lat = 19.4326
      let lon = -99.1332
      const pts = []
      for (let i = 0; i < N; i++) {
        lat += 0.0008 + Math.sin(i / 5) * 0.0004
        lon += 0.0010 + Math.cos(i / 4) * 0.0004
        const kmh = 25 + Math.abs(Math.sin(i / 3)) * 45 // 25–70 km/h
        pts.push({ lat, lon, speed: kmh / 3.6, t: fakeStart + (i * durationS) / N })
      }
      route.value = []
      distanceKm.value = 0
      maxSpeedKmh.value = 0
      startedAt.value = fakeStart
      tracking.value = true
      let i = 0
      const timer = setInterval(() => {
        if (i >= pts.length) {
          clearInterval(timer)
          resolve()
          return
        }
        const p = pts[i++]
        position.value = { lat: p.lat, lon: p.lon, accuracy: 5, speed: p.speed }
        const kmh = Math.round(p.speed * 3.6)
        if (kmh > maxSpeedKmh.value) maxSpeedKmh.value = kmh
        const pt = { lat: p.lat, lon: p.lon, t: p.t }
        const last = route.value[route.value.length - 1]
        if (last) distanceKm.value += haversineKm(last, pt)
        route.value.push(pt)
      }, 160)
    })
  }

  function saveTrip(name = '') {
    if (route.value.length < 2) return { ok: false, error: 'ruta muy corta' }
    return storeSaveTrip({
      name,
      points: route.value,
      started_at: startedAt.value,
      ended_at: Date.now() / 1000,
    })
  }

  const elapsedMin = computed(() =>
    startedAt.value ? (Date.now() / 1000 - startedAt.value) / 60 : 0
  )

  onMounted(startWatch) // seguir la ubicación desde que se abre el mapa
  onUnmounted(() => {
    if (watchId != null) navigator.geolocation.clearWatch(watchId)
  })

  return {
    supported,
    tracking,
    position,
    route,
    distanceKm,
    maxSpeedKmh,
    error,
    elapsedMin,
    startedAt,
    start,
    stop,
    simulate,
    saveTrip,
  }
}
