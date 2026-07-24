<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRide } from './composables/useRide'
import MapView from './components/MapView.vue'
import FuelSheet from './components/FuelSheet.vue'
import { getPlaces, addPlace, importPlaces } from './lib/store'
import { suggestDestination, discoverFrequentPlaces } from './lib/routines'
import logoLargo from './assets/logo_largo.webp'

const { speedKmh, gpsOk, gpsError, fuel, position, pollFuel } = useRide()

const showMap = ref(false)
const showFuel = ref(false)
const mapDestination = ref(null)

// Lugares favoritos para selección rápida en el tablero
const favorites = ref([])
function loadFavorites() { favorites.value = getPlaces() }

// Motor de rutinas: sugerencia por hora/día + descubrimiento de lugares
const suggestion = ref(null) // { place, score, visits }
const discovery = ref(null)  // { lat, lon, visits }
let routineTimer = null

function refreshRoutines() {
  suggestion.value = suggestDestination(new Date(), position.value)
  const found = discoverFrequentPlaces()
  discovery.value = found.length ? found[0] : null
}

function saveDiscovered() {
  if (!discovery.value) return
  const name = window.prompt('Vas seguido aquí. ¿Cómo se llama este lugar?')
  if (!name) return
  const category = (window.prompt('Categoría: casa / trabajo / comida / otro', 'otro') || 'otro')
    .trim().toLowerCase()
  addPlace({ name, lat: discovery.value.lat, lon: discovery.value.lon, category })
  loadFavorites()
  refreshRoutines()
}

// Importar lugares desde un enlace de un solo uso (?seed=...), sin exponerlos
// en el código público. Se guardan en el teléfono y se limpia la URL.
function checkSeedLink() {
  const seed = new URLSearchParams(location.search).get('seed')
  if (!seed) return
  try {
    const json = decodeURIComponent(escape(atob(seed)))
    const n = importPlaces(JSON.parse(json))
    if (n) loadFavorites()
  } catch (e) {
    console.warn('seed inválido', e)
  }
  history.replaceState({}, '', location.pathname) // quitar el ?seed= de la barra
}

onMounted(() => {
  checkSeedLink()
  loadFavorites()
  refreshRoutines()
  routineTimer = setInterval(refreshRoutines, 60000) // recalcula cada minuto (cambia la hora)
})
onUnmounted(() => { if (routineTimer) clearInterval(routineTimer) })

const catIcon = { casa: '🏠', trabajo: '💼', comida: '🍽', otro: '📍' }

function goTo(place) {
  mapDestination.value = place
  showMap.value = true
}
function openMap() {
  mapDestination.value = null
  showMap.value = true
}
function onMapClose() {
  showMap.value = false
  loadFavorites() // refrescar por si agregó lugares en el mapa
  refreshRoutines()
}

const SPEED_MAX = 160
const speedPct = computed(() => Math.min(100, (speedKmh.value / SPEED_MAX) * 100))

// Autonomía a mostrar: ajustada por velocidad si vamos en movimiento, si no la base
const rangeKm = computed(() => {
  const f = fuel.value
  if (!f) return null
  return f.range_km_now ?? f.range_km
})
const tankPct = computed(() => fuel.value?.tank_pct ?? null)
const lNow = computed(() => fuel.value?.l_per_100km_now ?? fuel.value?.l_per_100km ?? null)

const gps = computed(() => {
  if (!('geolocation' in navigator)) return { cls: 'is-danger', label: 'Sin GPS' }
  if (gpsError.value) return { cls: 'is-warn', label: 'GPS bloqueado' }
  if (!gpsOk.value) return { cls: 'is-warn', label: 'Buscando GPS…' }
  return { cls: 'is-ok', label: 'GPS activo' }
})

// Color del tanque según nivel
const tankCls = computed(() => {
  const p = tankPct.value
  if (p == null) return ''
  if (p <= 15) return 'danger'
  if (p <= 30) return 'warn'
  return 'ok'
})

function fmt(v, d = 0, dash = '—') {
  if (v == null || isNaN(v)) return dash
  return Number(v).toFixed(d)
}
</script>

<template>
  <MapView v-if="showMap" :destination="mapDestination" @close="onMapClose" />
  <FuelSheet v-if="showFuel" @close="showFuel = false" @changed="pollFuel" />

  <div class="dash">
    <header class="topbar">
      <img :src="logoLargo" alt="Royal Enfield" class="brand" />
      <div class="status" :class="gps.cls">
        <span class="dot" />
        <span class="lbl">{{ gps.label }}</span>
      </div>
    </header>

    <!-- VELOCIDAD GPS: protagonista -->
    <main class="speed-cell">
      <div class="micro">VELOCIDAD · GPS</div>
      <div class="big">
        <span class="num">{{ fmt(speedKmh, 0, '0') }}</span>
        <span class="unit">km/h</span>
      </div>
      <div class="bar"><div class="fill" :style="{ width: speedPct + '%' }" /></div>
      <div class="bar-ticks"><span>0</span><span>80</span><span>160</span></div>
    </main>

    <!-- GASOLINA: nivel + autonomía -->
    <section class="fuel-strip" :class="tankCls" @click="showFuel = true">
      <div class="fuel-tank">
        <div class="micro">TANQUE</div>
        <div class="tbar"><div class="tfill" :style="{ width: (tankPct ?? 0) + '%' }" /></div>
        <div class="tpct">{{ tankPct != null ? tankPct + '%' : '—' }} · {{ fmt(fuel?.current_fuel_l, 1) }} L</div>
      </div>
      <div class="fuel-range">
        <div class="micro">AUTONOMÍA</div>
        <div class="rnum">{{ fmt(rangeKm, 0) }}<small>km</small></div>
      </div>
      <div class="fuel-eco">
        <div class="micro">CONSUMO</div>
        <div class="enum">{{ fmt(lNow, 1) }}<small>L/100</small></div>
      </div>
    </section>

    <!-- Sugerencia inteligente (aprende de tus rutinas) -->
    <section v-if="suggestion" class="smart" @click="goTo(suggestion.place)">
      <span class="smart-ic">🧠</span>
      <div class="smart-txt">
        <span class="smart-lbl">
          {{ suggestion.from ? `Desde ${suggestion.from.name}, a esta hora sueles ir a` : 'A esta hora sueles ir a' }}
        </span>
        <span class="smart-dest">{{ suggestion.place.name }}</span>
      </div>
      <span class="smart-go">Trazar ruta ›</span>
    </section>
    <section v-else-if="discovery" class="smart discover" @click="saveDiscovered">
      <span class="smart-ic">📍</span>
      <div class="smart-txt">
        <span class="smart-lbl">Vas seguido a un lugar ({{ discovery.visits }} veces)</span>
        <span class="smart-dest">¿Guardarlo como favorito?</span>
      </div>
      <span class="smart-go">Guardar ›</span>
    </section>

    <!-- Favoritos: selección rápida → traza ruta -->
    <section class="favs">
      <div class="favs-head">
        <span class="micro">IR A</span>
      </div>
      <div class="favs-row">
        <button v-for="p in favorites" :key="p.id" class="fav" @click="goTo(p)">
          <span class="fav-ic">{{ catIcon[p.category] || '📍' }}</span>
          <span class="fav-name">{{ p.name }}</span>
        </button>
        <button class="fav add" @click="openMap">
          <span class="fav-ic">＋</span>
          <span class="fav-name">Agregar</span>
        </button>
      </div>
    </section>

    <!-- Accesos -->
    <nav class="actions">
      <button class="act" @click="showFuel = true">
        <span class="ai">⛽</span><span>Cargar gasolina</span>
      </button>
      <button class="act primary" @click="openMap">
        <span class="ai">🗺</span><span>Mapa y rutas</span>
      </button>
    </nav>

    <footer class="foot">
      <span>Odómetro <b>{{ fmt(fuel?.odometer_km, 1) }}</b> km</span>
      <span v-if="fuel && !fuel.economy_is_real" class="hint">Registra 2 cargas llenas para consumo real</span>
    </footer>
  </div>
</template>

<style scoped>
.dash {
  display: grid;
  grid-template-rows: auto 1fr auto auto auto auto;
  /* dvh, no vh: con la barra de Safari, 100vh recorta el tablero por abajo.
     width 100% en vez de 100vw para no desbordar si aparece scrollbar. */
  height: 100dvh; width: 100%;
  /* La barra de estado es translúcida y el viewport es viewport-fit=cover, así
     que sin esto el logo queda bajo la Dynamic Island y el odómetro bajo la
     barra de gestos. max() conserva el margen original como mínimo. */
  padding-top: max(0.5rem, env(safe-area-inset-top));
  padding-bottom: max(0.5rem, env(safe-area-inset-bottom));
  padding-left: max(0.7rem, env(safe-area-inset-left));
  padding-right: max(0.7rem, env(safe-area-inset-right));
  gap: 0.55rem;
  background: var(--c-bg);
}

/* SUGERENCIA INTELIGENTE */
.smart {
  display: flex; align-items: center; gap: 0.7rem;
  background: linear-gradient(90deg, rgba(88,166,255,0.12), var(--c-panel));
  border: 1px solid var(--c-info); border-radius: 10px;
  padding: 0.6rem 0.8rem; cursor: pointer;
}
.smart.discover { background: linear-gradient(90deg, rgba(210,153,34,0.12), var(--c-panel)); border-color: var(--c-warn); }
.smart-ic { font-size: 1.4rem; line-height: 1; }
.smart-txt { flex: 1; display: flex; flex-direction: column; line-height: 1.15; min-width: 0; }
.smart-lbl { font-size: 0.66rem; color: var(--c-muted); text-transform: uppercase; letter-spacing: 0.06em; }
.smart-dest { font-size: 1.05rem; font-weight: 700; color: var(--c-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.smart-go { font-size: 0.78rem; font-weight: 600; color: var(--c-info); white-space: nowrap; }
.smart.discover .smart-go { color: var(--c-warn); }

/* FAVORITOS */
.favs-head { margin-bottom: 0.3rem; }
.favs-row { display: flex; gap: 0.5rem; overflow-x: auto; padding-bottom: 0.15rem; }
.favs-row::-webkit-scrollbar { display: none; }
.fav {
  flex: 0 0 auto; display: flex; flex-direction: column; align-items: center; gap: 0.3rem;
  background: var(--c-panel); color: var(--c-fg); border: 1px solid var(--c-border);
  border-radius: 14px; padding: 0.75rem 0.9rem; min-width: 88px; min-height: 74px;
  justify-content: center; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.25);
}
.fav:active { transform: scale(0.97); border-color: var(--c-info); }
.fav-ic { font-size: 1.7rem; line-height: 1; }
.fav-name { font-size: 0.82rem; color: var(--c-fg); max-width: 92px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fav.add { border-style: dashed; }
.fav.add .fav-ic { color: var(--c-info); }

/* TOPBAR */
.topbar { display: flex; justify-content: space-between; align-items: center; padding: 0 0.2rem; }
.brand { height: 22px; width: auto; }
.status { display: flex; align-items: center; gap: 0.4rem; font-size: 0.72rem; color: var(--c-muted); text-transform: uppercase; letter-spacing: 0.08em; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c-muted); }
.status.is-ok .dot { background: var(--c-success); }
.status.is-ok .lbl { color: var(--c-fg); }
.status.is-warn .dot { background: var(--c-warn); }
.status.is-warn .lbl { color: var(--c-warn); }
.status.is-danger .dot { background: var(--c-danger); }
.status.is-danger .lbl { color: var(--c-danger); }

.micro { font-size: 0.62rem; letter-spacing: 0.16em; color: var(--c-muted); text-transform: uppercase; margin-bottom: 0.2rem; }

/* SPEED */
.speed-cell {
  background: var(--c-panel); border: 1px solid var(--c-border); border-radius: 10px;
  padding: 0.8rem 1rem; display: flex; flex-direction: column; justify-content: center; min-height: 0;
}
.big { display: flex; align-items: baseline; gap: 0.5rem; line-height: 0.9; margin-bottom: 0.5rem; }
.big .num { font-size: clamp(3rem, 12vw, 5rem); font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -0.03em; color: var(--c-fg); }
.big .unit { font-size: 1rem; color: var(--c-muted); }
.bar { position: relative; height: 7px; background: var(--c-bar-bg); border-radius: 4px; overflow: hidden; }
.bar .fill { height: 100%; background: linear-gradient(90deg, var(--c-success), var(--c-info)); transition: width 0.3s ease-out; }
.bar-ticks { display: flex; justify-content: space-between; font-size: 0.6rem; color: var(--c-muted); margin-top: 0.15rem; font-variant-numeric: tabular-nums; }

/* FUEL STRIP */
.fuel-strip {
  display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 0.6rem;
  background: var(--c-panel); border: 1px solid var(--c-border); border-radius: 10px;
  padding: 0.7rem 0.9rem; cursor: pointer;
}
.fuel-strip.warn { border-color: var(--c-warn); }
.fuel-strip.danger { border-color: var(--c-danger); box-shadow: 0 0 10px rgba(248,81,73,0.2); }
.tbar { height: 9px; background: var(--c-bar-bg); border-radius: 5px; overflow: hidden; margin-bottom: 0.3rem; }
.tfill { height: 100%; background: linear-gradient(90deg, var(--c-danger), var(--c-warn), var(--c-success)); transition: width 0.3s; }
.tpct { font-size: 0.75rem; color: var(--c-fg); font-variant-numeric: tabular-nums; }
.rnum, .enum { font-size: 1.6rem; font-weight: 800; color: var(--c-fg); font-variant-numeric: tabular-nums; line-height: 1; }
.rnum small, .enum small { font-size: 0.6rem; color: var(--c-muted); margin-left: 0.15rem; font-weight: 400; }
.fuel-range .rnum { color: var(--c-info); }

/* ACTIONS */
.actions { display: flex; gap: 0.6rem; }
.act {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 0.5rem;
  background: var(--c-panel); color: var(--c-fg); border: 1px solid var(--c-border);
  border-radius: 14px; padding: 1.15rem; font-size: 1.05rem; font-weight: 700; cursor: pointer;
  min-height: 58px; box-shadow: 0 2px 8px rgba(0,0,0,0.25);
}
.act .ai { font-size: 1.35rem; }
.act.primary { border-color: var(--c-info); color: var(--c-info); background: linear-gradient(180deg, rgba(88,166,255,0.1), var(--c-panel)); }
.act:active { transform: scale(0.98); }

/* FOOTER */
.foot { display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem; color: var(--c-muted); padding: 0 0.2rem; flex-wrap: wrap; gap: 0.4rem; }
.foot b { color: var(--c-fg); font-weight: 700; }
.foot .hint { font-size: 0.68rem; color: var(--c-warn); }
</style>
