import { ref, onMounted, onUnmounted } from 'vue'
import { haversineKm, addDistance, fuelStatus } from '../lib/store'

/**
 * GPS en vivo para la pantalla principal (sin OBD):
 *  - velocidad actual (km/h) desde el GPS
 *  - alimenta el odómetro (en el teléfono) con la distancia recorrida
 *  - calcula el estado de la gasolina (ajustado por la velocidad actual)
 *
 * Todo corre en el propio teléfono (sin servidor). Requiere contexto seguro
 * (https:// o localhost) para que el navegador permita la geolocalización.
 */
export function useRide() {
  const supported = 'geolocation' in navigator
  const speedKmh = ref(0)
  const gpsOk = ref(false)
  const gpsError = ref(null)
  const fuel = ref(null)
  const position = ref(null) // { lat, lon }

  let watchId = null
  let last = null // último punto {lat, lon}
  let pendingKm = 0 // distancia sin sincronizar al backend
  let flushTimer = null
  let fuelTimer = null

  const MIN_STEP_KM = 0.006
  const MAX_ACCURACY_M = 60

  function onPos(pos) {
    gpsOk.value = true
    gpsError.value = null
    const { latitude, longitude, accuracy, speed } = pos.coords

    // Velocidad: el GPS la da en m/s; si no, la estimamos por distancia/tiempo.
    if (speed != null && speed >= 0) {
      speedKmh.value = Math.round(speed * 3.6)
    }

    position.value = { lat: latitude, lon: longitude }
    if (accuracy != null && accuracy > MAX_ACCURACY_M) return
    const pt = { lat: latitude, lon: longitude }
    if (last) {
      const step = haversineKm(last, pt)
      if (step >= MIN_STEP_KM) {
        pendingKm += step
        last = pt
      }
    } else {
      last = pt
    }
  }

  function onErr(err) {
    gpsError.value = err.message || 'GPS no disponible'
    gpsOk.value = false
  }

  function flushOdometer() {
    if (pendingKm <= 0) return
    addDistance(pendingKm)
    pendingKm = 0
  }

  function pollFuel() {
    fuel.value = fuelStatus(speedKmh.value || 0)
  }

  onMounted(() => {
    if (supported) {
      watchId = navigator.geolocation.watchPosition(onPos, onErr, {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 15000,
      })
    } else {
      gpsError.value = 'Este dispositivo no tiene GPS'
    }
    flushTimer = setInterval(flushOdometer, 8000) // sube km cada 8s
    fuelTimer = setInterval(pollFuel, 3000)
    pollFuel()
  })

  onUnmounted(() => {
    if (watchId != null) navigator.geolocation.clearWatch(watchId)
    if (flushTimer) clearInterval(flushTimer)
    if (fuelTimer) clearInterval(fuelTimer)
    flushOdometer()
  })

  return { supported, speedKmh, gpsOk, gpsError, fuel, position, pollFuel }
}
