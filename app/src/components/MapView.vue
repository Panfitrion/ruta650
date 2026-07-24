<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Protocol } from 'pmtiles'
import { layers, namedFlavor } from '@protomaps/basemaps'
import { useGeoTracker } from '../composables/useGeoTracker'
import { getPlaces, addPlace, deletePlace, getTrips } from '../lib/store'
import { getRoute } from '../lib/routing'

// Registrar el protocolo pmtiles una sola vez (mapa offline desde cdmx.pmtiles)
const _proto = new Protocol()
maplibregl.addProtocol('pmtiles', _proto.tile)

// Los recursos del mapa se resuelven contra la carpeta donde vive la app, no
// contra la raíz del dominio: así funciona también en /ruta650/.
const asset = (p) => new URL(p, document.baseURI).href

const props = defineProps({ destination: { type: Object, default: null } })
const emit = defineEmits(['close'])

const CDMX = [-99.1332, 19.4326] // MapLibre usa [lon, lat]
const geo = useGeoTracker()

const mapEl = ref(null)
let map = null
let placeMarkers = []
let meMarker = null

const places = ref([])
const trips = ref([])
const totalKm = ref(0)
const addMode = ref(false)
const showTrips = ref(false)
const banner = ref('')
const mapError = ref('')
const routeInfo = ref(null) // { name, distanceKm, durationMin, online }
const summary = ref(null) // resumen al terminar un viaje grabado
const tripName = ref('')
let destMarker = null
let routed = false

// Modo conducción: se activa al grabar ruta o al ir a un lugar → muestra velocidad
const ridingMode = computed(() => geo.tracking.value || !!routeInfo.value)
const speedKmh = computed(() => {
  const s = geo.position.value?.speed
  return s != null && s >= 0 ? Math.round(s * 3.6) : 0
})

function mapStyle() {
  return {
    version: 8,
    glyphs: asset('fonts/{fontstack}/{range}.pbf'),
    sprite: asset('sprites/light'),
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${asset('cdmx.pmtiles')}`,
        attribution: '© OpenStreetMap',
      },
    },
    layers: layers('protomaps', namedFlavor('light'), { lang: 'es' }),
  }
}

function placeEl(category) {
  const color =
    { casa: '#3fb950', trabajo: '#58a6ff', comida: '#d29922', otro: '#b0541c' }[category] ||
    '#b0541c'
  const el = document.createElement('div')
  el.className = 'place-pin'
  el.innerHTML = `<span style="background:${color}"></span>`
  return el
}

function meEl() {
  const el = document.createElement('div')
  el.className = 'me-pin'
  el.innerHTML = '<span class="pulse"></span>'
  return el
}

function loadPlaces() {
  places.value = getPlaces()
  renderPlaces()
}

function loadTrips() {
  const d = getTrips()
  trips.value = d.trips || []
  totalKm.value = d.summary?.total_km || 0
}

function renderPlaces() {
  if (!map) return
  placeMarkers.forEach((m) => m.remove())
  placeMarkers = []
  for (const p of places.value) {
    const popup = new maplibregl.Popup({ offset: 14, closeButton: false }).setHTML(
      `<b>${p.name}</b><br><button data-del="${p.id}" class="pop-del">Eliminar</button>`
    )
    const m = new maplibregl.Marker({ element: placeEl(p.category) })
      .setLngLat([p.lon, p.lat])
      .setPopup(popup)
      .addTo(map)
    placeMarkers.push(m)
  }
}

function flash(msg) {
  banner.value = msg
  setTimeout(() => { if (banner.value === msg) banner.value = '' }, 2500)
}

function onMapClick(e) {
  if (!addMode.value) return
  const name = window.prompt('Nombre del lugar (ej. Casa, Trabajo):')
  if (!name) { addMode.value = false; return }
  const category = (window.prompt('Categoría: casa / trabajo / comida / otro', 'otro') || 'otro')
    .trim().toLowerCase()
  addPlace({ name, lat: e.lngLat.lat, lon: e.lngLat.lng, category })
  loadPlaces()
  flash(`Guardado: ${name}`)
  addMode.value = false
}

function onPopupClick(ev) {
  const id = ev.target?.getAttribute?.('data-del')
  if (!id) return
  deletePlace(id)
  loadPlaces()
  flash('Lugar eliminado')
}

function ensureRouteLayer() {
  if (!map) return
  if (!map.getSource('route')) {
    map.addSource('route', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } },
    })
    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      paint: { 'line-color': '#b0541c', 'line-width': 5, 'line-opacity': 0.9 },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    })
  }
  if (!map.getSource('nav')) {
    map.addSource('nav', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } },
    })
    map.addLayer({
      id: 'nav-line',
      type: 'line',
      source: 'nav',
      paint: { 'line-color': '#2f6fdb', 'line-width': 6, 'line-opacity': 0.85 },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    })
  }
}

// Traza la ruta desde tu ubicación hasta el destino seleccionado
async function drawRouteTo(dest) {
  if (!map || !dest) return
  const from = geo.position.value
  if (!from) { flash('Buscando tu ubicación…'); return }
  ensureRouteLayer()
  flash(`Calculando ruta a ${dest.name}…`)
  const r = await getRoute(from, { lat: dest.lat, lon: dest.lon })
  if (map.getSource('nav')) {
    map.getSource('nav').setData({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: r.coords },
    })
  }
  // Marcador del destino
  if (destMarker) destMarker.remove()
  const el = placeEl(dest.category || 'otro')
  el.classList.add('dest-pin')
  destMarker = new maplibregl.Marker({ element: el }).setLngLat([dest.lon, dest.lat]).addTo(map)
  // Encuadrar la ruta
  const b = new maplibregl.LngLatBounds()
  r.coords.forEach((c) => b.extend(c))
  b.extend([from.lon, from.lat])
  map.fitBounds(b, { padding: 60, maxZoom: 15, duration: 700 })
  routeInfo.value = {
    name: dest.name,
    distanceKm: r.distanceKm,
    durationMin: r.durationMin,
    online: r.online,
  }
}

function clearRoute() {
  routeInfo.value = null
  if (destMarker) { destMarker.remove(); destMarker = null }
  if (map && map.getSource('nav')) {
    map.getSource('nav').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } })
  }
}

watch(() => geo.route.value.length, () => {
  if (!map || !map.getSource('route')) return
  const coords = geo.route.value.map((p) => [p.lon, p.lat])
  map.getSource('route').setData({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: coords },
  })
})

watch(() => geo.position.value, (pos) => {
  if (!map || !pos) return
  const ll = [pos.lon, pos.lat]
  if (meMarker) meMarker.setLngLat(ll)
  else meMarker = new maplibregl.Marker({ element: meEl() }).setLngLat(ll).addTo(map)
  if (geo.tracking.value) map.panTo(ll, { duration: 500 })
  // Si abrimos con un destino, trazar la ruta en cuanto haya ubicación
  if (props.destination && !routed) {
    routed = true
    drawRouteTo(props.destination)
  }
})

function clearRecordedLine() {
  if (map && map.getSource('route')) {
    map.getSource('route').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } })
  }
}

function finishTrip() {
  if (geo.route.value.length >= 2) {
    const b = new maplibregl.LngLatBounds()
    geo.route.value.forEach((p) => b.extend([p.lon, p.lat]))
    if (map) map.fitBounds(b, { padding: 60, maxZoom: 15, duration: 700 })
    const mins = geo.elapsedMin.value
    const km = geo.distanceKm.value
    const avg = mins > 0.5 ? km / (mins / 60) : 0
    summary.value = {
      km: Math.round(km * 100) / 100,
      minutes: Math.round(mins),
      avgKmh: Math.round(avg),
      maxKmh: geo.maxSpeedKmh.value,
    }
    tripName.value = ''
  } else {
    flash('Ruta muy corta, no se guardó')
    clearRecordedLine()
  }
}

function toggleTrip() {
  if (geo.tracking.value) {
    geo.stop()
    finishTrip()
  } else {
    if (!geo.supported) { flash('Este dispositivo no tiene GPS'); return }
    geo.start()
    flash('Grabando ruta por GPS…')
  }
}

// Simular una ruta (para probar sin salir a manejar)
const simulating = ref(false)
async function runSimulation() {
  if (geo.tracking.value || simulating.value) return
  simulating.value = true
  flash('Simulando ruta por CDMX…')
  await geo.simulate()
  geo.stop()
  finishTrip()
  simulating.value = false
}

function saveTripFromSummary() {
  const r = geo.saveTrip(tripName.value.trim())
  if (r.ok) { flash(`Viaje guardado: ${r.trip.km} km`); loadTrips() }
  summary.value = null
  clearRecordedLine()
}

function discardTrip() {
  summary.value = null
  clearRecordedLine()
  flash('Viaje descartado')
}

onMounted(() => {
  map = new maplibregl.Map({
    container: mapEl.value,
    style: mapStyle(),
    center: CDMX,
    zoom: 12,
    attributionControl: false,
  })
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
  map.on('load', () => {
    map.resize() // por si el contenedor midió 0 al iniciar (overlay)
    ensureRouteLayer()
    loadPlaces()
  })
  // Mostrar errores del mapa en pantalla (la consola no está disponible)
  map.on('error', (e) => {
    const m = e?.error?.message || String(e?.error || 'error de mapa')
    mapError.value = m
    console.error('[map]', m)
  })
  map.on('click', onMapClick)
  document.addEventListener('click', onPopupClick)
  loadTrips()
})

onUnmounted(() => {
  geo.stop()
  document.removeEventListener('click', onPopupClick)
  if (map) map.remove()
})
</script>

<template>
  <div class="map-screen">
    <div ref="mapEl" class="map"></div>

    <div class="map-top">
      <button class="back-btn" @click="emit('close')">
        <span class="back-ic">‹</span>
        <span class="back-lbl">Tablero</span>
      </button>
      <div class="total-km">
        <span class="tk-num">{{ totalKm.toFixed(1) }}</span>
        <span class="tk-lbl">km totales</span>
      </div>
      <button class="mbtn" :class="{ active: showTrips }" @click="showTrips = !showTrips">Viajes</button>
    </div>

    <div v-if="banner" class="banner">{{ banner }}</div>
    <div v-if="mapError" class="map-error">⚠ Mapa: {{ mapError }}</div>

    <!-- Panel de ruta activa -->
    <div v-if="routeInfo" class="route-info">
      <div class="ri-main">
        <span class="ri-dest">→ {{ routeInfo.name }}</span>
        <button class="ri-x" @click="clearRoute">✕</button>
      </div>
      <div class="ri-meta">
        <b>{{ routeInfo.distanceKm }}</b> km
        <template v-if="routeInfo.durationMin"> · <b>{{ routeInfo.durationMin }}</b> min</template>
        <span class="ri-mode">{{ routeInfo.online ? 'por calles' : 'línea directa (sin internet)' }}</span>
      </div>
    </div>

    <div v-if="showTrips" class="trips-panel">
      <h3>Registro de km</h3>
      <p v-if="!trips.length" class="empty">Aún no hay viajes grabados.</p>
      <ul v-else>
        <li v-for="t in trips" :key="t.id">
          <span class="t-km">{{ t.km.toFixed(1) }} km</span>
          <span class="t-name">{{ t.name || 'Sin nombre' }}</span>
          <span class="t-date">{{ new Date(t.started_at * 1000).toLocaleDateString('es-MX') }}</span>
        </li>
      </ul>
    </div>

    <!-- Resumen al terminar el viaje -->
    <div v-if="summary" class="trip-summary">
      <h3>🏁 Resumen del viaje</h3>
      <div class="ts-grid">
        <div class="ts-cell"><span class="ts-num">{{ summary.km }}</span><span class="ts-lbl">km</span></div>
        <div class="ts-cell"><span class="ts-num">{{ summary.minutes }}</span><span class="ts-lbl">minutos</span></div>
        <div class="ts-cell"><span class="ts-num">{{ summary.avgKmh }}</span><span class="ts-lbl">km/h prom</span></div>
        <div class="ts-cell"><span class="ts-num">{{ summary.maxKmh }}</span><span class="ts-lbl">km/h máx</span></div>
      </div>
      <input v-model="tripName" class="ts-input" placeholder="Nombre del viaje (opcional)" />
      <div class="ts-actions">
        <button class="ts-discard" @click="discardTrip">Descartar</button>
        <button class="ts-save" @click="saveTripFromSummary">Guardar viaje</button>
      </div>
    </div>

    <!-- Modo conducción: velocímetro sobre el mapa -->
    <div v-if="ridingMode && !summary" class="drive-speed">
      <span class="ds-num">{{ speedKmh }}</span>
      <span class="ds-unit">km/h</span>
    </div>

    <div class="map-bottom">
      <button class="pill" :class="{ on: addMode }" @click="addMode = !addMode">
        {{ addMode ? '📍 Toca el mapa…' : '＋ Lugar' }}
      </button>
      <button class="pill rec" :class="{ on: geo.tracking.value }" @click="toggleTrip">
        <span v-if="geo.tracking.value">■ Parar · {{ geo.distanceKm.value.toFixed(2) }} km</span>
        <span v-else>● Grabar ruta</span>
      </button>
      <button class="pill sim" :disabled="geo.tracking.value || simulating" @click="runSimulation" title="Simular una ruta de prueba">🧪</button>
    </div>
  </div>
</template>

<style scoped>
.map-screen { position: fixed; inset: 0; z-index: 100; background: #e8e6e1; }
.map { position: absolute; inset: 0; }

.map-top {
  position: absolute; top: 0; left: 0; right: 0; z-index: 500;
  display: flex; align-items: center; justify-content: space-between;
  gap: 0.5rem; padding: 0.5rem 0.7rem;
  /* Sin esto el botón de regresar queda bajo la Dynamic Island. */
  padding-top: max(0.5rem, env(safe-area-inset-top));
  background: linear-gradient(180deg, rgba(13,17,23,0.85), rgba(13,17,23,0));
}
.mbtn {
  background: var(--c-panel); color: var(--c-fg);
  border: 1px solid var(--c-border); border-radius: 999px;
  padding: 0.7rem 1.1rem; font-size: 0.98rem; font-weight: 600;
  min-height: 46px; cursor: pointer;
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
}
.mbtn.active { border-color: var(--c-info); color: var(--c-info); }
.mbtn:active { transform: scale(0.96); }

/* Botón de regresar al tablero — grande y fácil de tocar */
.back-btn {
  display: flex; align-items: center; gap: 0.35rem;
  background: var(--c-info); color: #fff;
  border: none; border-radius: 999px;
  padding: 0.7rem 1.25rem 0.7rem 0.95rem;
  font-size: 1.05rem; font-weight: 700; min-height: 46px; cursor: pointer;
  box-shadow: 0 2px 10px rgba(0,0,0,0.35);
}
.back-btn:active { transform: scale(0.96); filter: brightness(0.92); }
.back-ic { font-size: 1.6rem; line-height: 1; margin-top: -3px; }
.back-lbl { letter-spacing: 0.01em; }
.total-km { text-align: center; color: #fff; line-height: 1; text-shadow: 0 1px 3px rgba(0,0,0,0.6); }
.tk-num { font-size: 1.15rem; font-weight: 800; font-variant-numeric: tabular-nums; }
.tk-lbl { display: block; font-size: 0.6rem; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.85; }

.banner {
  position: absolute; top: 3.2rem; left: 50%; transform: translateX(-50%);
  z-index: 600; background: var(--c-panel); color: var(--c-fg);
  border: 1px solid var(--c-info); border-radius: 8px;
  padding: 0.4rem 0.9rem; font-size: 0.8rem; white-space: nowrap;
}
.map-error {
  position: absolute; bottom: 4rem; left: 0.6rem; right: 0.6rem;
  z-index: 650; background: #2e1c19; color: #ffb3a7;
  border: 1px solid #b83227; border-radius: 8px;
  padding: 0.5rem 0.8rem; font-size: 0.75rem; word-break: break-word;
}
.route-info {
  position: absolute; top: 3rem; left: 0.6rem; right: 0.6rem; z-index: 600;
  background: var(--c-panel); border: 1px solid #2f6fdb; border-radius: 10px;
  padding: 0.5rem 0.8rem;
}
.ri-main { display: flex; justify-content: space-between; align-items: center; }
.ri-dest { font-weight: 700; color: var(--c-fg); font-size: 0.95rem; }
.ri-x { background: none; border: none; color: var(--c-muted); font-size: 1rem; cursor: pointer; }
.ri-meta { font-size: 0.8rem; color: var(--c-muted); margin-top: 0.15rem; }
.ri-meta b { color: #58a6ff; font-variant-numeric: tabular-nums; }
.ri-mode { margin-left: 0.4rem; font-size: 0.7rem; opacity: 0.8; }

.trips-panel {
  position: absolute; top: 3rem; right: 0.6rem; z-index: 600;
  width: min(320px, 80vw); max-height: 60vh; overflow-y: auto;
  background: var(--c-panel); border: 1px solid var(--c-border);
  border-radius: 10px; padding: 0.7rem 0.9rem;
}
.trips-panel h3 { margin: 0 0 0.5rem; font-size: 0.9rem; color: var(--c-fg); }
.trips-panel .empty { color: var(--c-muted); font-size: 0.82rem; margin: 0; }
.trips-panel ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
.trips-panel li {
  display: grid; grid-template-columns: auto 1fr auto; gap: 0.5rem; align-items: baseline;
  font-size: 0.8rem; padding: 0.35rem 0; border-bottom: 1px solid var(--c-border);
}
.t-km { font-weight: 700; color: var(--c-info); font-variant-numeric: tabular-nums; }
.t-name { color: var(--c-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.t-date { color: var(--c-muted); font-size: 0.72rem; }

/* Resumen del viaje */
.trip-summary {
  position: absolute; bottom: 0; left: 0; right: 0; z-index: 700;
  background: var(--c-panel); border-top: 1px solid var(--c-border);
  border-radius: 18px 18px 0 0; padding: 1rem 1.1rem 1.3rem;
  padding-bottom: max(1.3rem, env(safe-area-inset-bottom));
  box-shadow: 0 -6px 24px rgba(0,0,0,0.45);
}
.trip-summary h3 { margin: 0 0 0.8rem; font-size: 1.1rem; color: var(--c-fg); text-align: center; }
.ts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; margin-bottom: 0.9rem; }
.ts-cell {
  display: flex; flex-direction: column; align-items: center;
  background: var(--c-bg); border: 1px solid var(--c-border); border-radius: 12px; padding: 0.8rem 0.5rem;
}
.ts-num { font-size: 2rem; font-weight: 800; color: var(--c-info); font-variant-numeric: tabular-nums; line-height: 1; }
.ts-lbl { font-size: 0.72rem; color: var(--c-muted); text-transform: uppercase; letter-spacing: 0.06em; margin-top: 0.25rem; }
.ts-input {
  width: 100%; box-sizing: border-box; background: var(--c-bg); border: 1px solid var(--c-border);
  border-radius: 10px; padding: 0.8rem; color: var(--c-fg); font-size: 1rem; margin-bottom: 0.8rem;
}
.ts-actions { display: flex; gap: 0.6rem; }
.ts-discard, .ts-save {
  flex: 1; border-radius: 12px; padding: 0.9rem; font-size: 1rem; font-weight: 700; cursor: pointer; min-height: 52px;
}
.ts-discard { background: transparent; color: var(--c-muted); border: 1px solid var(--c-border); }
.ts-save { background: var(--c-info); color: #fff; border: none; }
.ts-save:active, .ts-discard:active { transform: scale(0.98); }

/* Velocímetro del modo conducción */
.drive-speed {
  position: absolute; bottom: 5rem; left: 0.7rem; z-index: 550;
  display: flex; flex-direction: column; align-items: center;
  background: rgba(13,17,23,0.82); backdrop-filter: blur(6px);
  border: 1px solid var(--c-border); border-radius: 16px;
  padding: 0.5rem 0.9rem; min-width: 96px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
}
.ds-num { font-size: 3rem; font-weight: 800; color: #fff; line-height: 0.95; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.ds-unit { font-size: 0.72rem; color: var(--c-muted); text-transform: uppercase; letter-spacing: 0.1em; }

.map-bottom {
  position: absolute; bottom: 0; left: 0; right: 0; z-index: 500;
  display: flex; gap: 0.6rem; padding: 0.7rem;
  /* Los botones no deben quedar bajo la barra de gestos del iPhone. */
  padding-bottom: max(0.7rem, env(safe-area-inset-bottom));
  background: linear-gradient(0deg, rgba(13,17,23,0.85), rgba(13,17,23,0));
}
.pill {
  flex: 1; background: var(--c-panel); color: var(--c-fg);
  border: 1px solid var(--c-border); border-radius: 12px;
  padding: 1rem 0.6rem; font-size: 1rem; font-weight: 700; cursor: pointer;
  font-variant-numeric: tabular-nums; min-height: 54px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
}
.pill:active { transform: scale(0.98); }
.pill.on { border-color: var(--c-info); color: var(--c-info); }
.pill.rec.on { border-color: var(--c-danger); color: var(--c-danger); }
.pill.sim { flex: 0 0 auto; min-width: 54px; font-size: 1.3rem; padding: 1rem 0.7rem; }
.pill.sim:disabled { opacity: 0.4; }
</style>

<style>
.place-pin span {
  display: block; width: 18px; height: 18px; border-radius: 50%;
  border: 2px solid #fff; box-shadow: 0 0 4px rgba(0,0,0,0.5); cursor: pointer;
}
.me-pin .pulse {
  display: block; width: 16px; height: 16px; border-radius: 50%;
  background: #2f6fdb; border: 2px solid #fff;
  box-shadow: 0 0 0 rgba(47,111,219,0.6); animation: gpspulse 1.8s infinite;
}
@keyframes gpspulse {
  0% { box-shadow: 0 0 0 0 rgba(47,111,219,0.5); }
  70% { box-shadow: 0 0 0 12px rgba(47,111,219,0); }
  100% { box-shadow: 0 0 0 0 rgba(47,111,219,0); }
}
.place-pin.dest-pin span { width: 24px; height: 24px; border-width: 3px; box-shadow: 0 0 0 4px rgba(47,111,219,0.35); }
.pop-del {
  margin-top: 4px; background: #b83227; color: #fff; border: none;
  border-radius: 4px; padding: 2px 8px; font-size: 0.75rem; cursor: pointer;
}
.maplibregl-popup-content { background: #fff; color: #111; border-radius: 8px; }
</style>
