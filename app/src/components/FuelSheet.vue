<script setup>
import { ref, onMounted } from 'vue'
import { fuelStatus, getFuelLog, addFillup, deleteFillup } from '../lib/store'

const emit = defineEmits(['close', 'changed'])

const liters = ref('')
const cost = ref('')
const full = ref(true)
const log = ref([])
const status = ref(null)
const saving = ref(false)
const msg = ref('')

function load() {
  status.value = fuelStatus()
  log.value = getFuelLog()
}

function submit() {
  const L = parseFloat(liters.value)
  if (!L || L <= 0) { msg.value = 'Escribe cuántos litros cargaste'; return }
  saving.value = true
  msg.value = ''
  addFillup({ liters: L, full: full.value, cost: cost.value ? parseFloat(cost.value) : null })
  liters.value = ''
  cost.value = ''
  msg.value = 'Carga registrada ✓'
  load()
  emit('changed')
  saving.value = false
}

function del(id) {
  deleteFillup(id)
  load()
  emit('changed')
}

function fmtDate(t) {
  return new Date(t * 1000).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
}

onMounted(load)
</script>

<template>
  <div class="sheet-overlay" @click.self="emit('close')">
    <div class="sheet">
      <div class="sheet-head">
        <h2>⛽ Gasolina</h2>
        <button class="x" @click="emit('close')">✕</button>
      </div>

      <!-- Estado actual -->
      <div v-if="status" class="fuel-state">
        <div class="fs-main">
          <div class="fs-tank">
            <div class="fs-bar"><div class="fs-fill" :style="{ width: (status.tank_pct ?? 0) + '%' }" /></div>
            <span class="fs-pct">{{ status.tank_pct ?? '—' }}%</span>
          </div>
          <div class="fs-nums">
            <span><b>{{ status.current_fuel_l ?? '—' }}</b> L</span>
            <span><b>{{ status.range_km ?? '—' }}</b> km autonomía</span>
          </div>
        </div>
        <p class="fs-note">
          Consumo: <b>{{ status.l_per_100km }}</b> L/100km
          <span v-if="!status.economy_is_real"> (estimado — registra 2 cargas a tanque lleno para el real)</span>
          <span v-if="status.cost_per_km"> · ${{ status.cost_per_km }}/km</span>
        </p>
      </div>

      <!-- Registrar carga -->
      <div class="form">
        <div class="row">
          <label>Litros cargados
            <input v-model="liters" type="number" inputmode="decimal" step="0.01" placeholder="ej. 9.5" />
          </label>
          <label>Costo total (opc.)
            <input v-model="cost" type="number" inputmode="decimal" step="0.01" placeholder="$" />
          </label>
        </div>
        <label class="chk">
          <input v-model="full" type="checkbox" /> Llené el tanque a tope
        </label>
        <button class="save" :disabled="saving" @click="submit">
          {{ saving ? 'Guardando…' : 'Registrar carga' }}
        </button>
        <p v-if="msg" class="msg">{{ msg }}</p>
      </div>

      <!-- Historial -->
      <div class="hist" v-if="log.length">
        <h3>Historial</h3>
        <ul>
          <li v-for="f in log" :key="f.id">
            <span class="h-date">{{ fmtDate(f.t) }}</span>
            <span class="h-l">{{ f.liters }} L{{ f.full ? '' : ' (parcial)' }}</span>
            <span class="h-cost">{{ f.cost ? '$' + f.cost : '' }}</span>
            <button class="h-del" @click="del(f.id)">✕</button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sheet-overlay {
  position: fixed; inset: 0; z-index: 120; background: rgba(0,0,0,0.7);
  display: flex; align-items: flex-end; justify-content: center;
}
.sheet {
  background: var(--c-panel); border: 1px solid var(--c-border);
  border-radius: 14px 14px 0 0; width: min(560px, 100%);
  max-height: 92dvh; overflow-y: auto; padding: 1rem 1.1rem 1.4rem;
  /* La hoja se pega al borde inferior: respeta la barra de gestos. */
  padding-bottom: max(1.4rem, env(safe-area-inset-bottom));
  overscroll-behavior: contain; /* no arrastrar la página al llegar al final */
}
.sheet-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem; }
.sheet-head h2 { margin: 0; font-size: 1.1rem; color: var(--c-fg); }
.x { background: none; border: none; color: var(--c-muted); font-size: 1.1rem; cursor: pointer; }

.fuel-state { background: var(--c-bg); border: 1px solid var(--c-border); border-radius: 10px; padding: 0.8rem; margin-bottom: 1rem; }
.fs-main { display: flex; align-items: center; gap: 1rem; }
.fs-tank { flex: 1; }
.fs-bar { height: 12px; background: var(--c-bar-bg); border-radius: 6px; overflow: hidden; }
.fs-fill { height: 100%; background: linear-gradient(90deg, var(--c-danger), var(--c-warn), var(--c-success)); transition: width 0.3s; }
.fs-pct { font-size: 0.8rem; color: var(--c-muted); }
.fs-nums { display: flex; flex-direction: column; text-align: right; font-size: 0.85rem; color: var(--c-muted); }
.fs-nums b { color: var(--c-fg); font-size: 1.1rem; font-variant-numeric: tabular-nums; }
.fs-note { font-size: 0.75rem; color: var(--c-muted); margin: 0.6rem 0 0; }
.fs-note b { color: var(--c-info); }

.form { display: flex; flex-direction: column; gap: 0.7rem; }
.row { display: flex; gap: 0.7rem; }
.form label { flex: 1; display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.75rem; color: var(--c-muted); }
.form input[type="number"] {
  background: var(--c-bg); border: 1px solid var(--c-border); border-radius: 8px;
  padding: 0.6rem; color: var(--c-fg); font-size: 1rem;
}
.chk { flex-direction: row !important; align-items: center; gap: 0.4rem !important; font-size: 0.85rem !important; color: var(--c-fg) !important; }
.save {
  background: var(--c-info); color: var(--c-bg); border: none; border-radius: 8px;
  padding: 0.75rem; font-size: 0.95rem; font-weight: 700; cursor: pointer; margin-top: 0.2rem;
}
.save:disabled { opacity: 0.6; }
.msg { font-size: 0.82rem; color: var(--c-info); margin: 0.2rem 0 0; text-align: center; }

.hist { margin-top: 1.2rem; }
.hist h3 { font-size: 0.85rem; color: var(--c-fg); margin: 0 0 0.5rem; }
.hist ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; }
.hist li { display: grid; grid-template-columns: auto 1fr auto auto; gap: 0.6rem; align-items: center; font-size: 0.82rem; padding: 0.4rem 0; border-bottom: 1px solid var(--c-border); }
.h-date { color: var(--c-muted); }
.h-l { color: var(--c-fg); font-weight: 600; }
.h-cost { color: var(--c-muted); font-variant-numeric: tabular-nums; }
.h-del { background: none; border: none; color: var(--c-muted); cursor: pointer; font-size: 0.8rem; }
/* En pantalla táctil no hay hover: el color se quedaría "pegado" tras tocar. */
@media (hover: hover) {
  .h-del:hover { color: var(--c-danger); }
}
.h-del:active { color: var(--c-danger); }
</style>
