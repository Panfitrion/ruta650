/*
 * Service worker de "Ruta 650".
 *
 * Hace que la app corra 100% OFFLINE en el iPhone (sin la Mac):
 *  - Precachea el "esqueleto" (app, fuentes y sprites del mapa).
 *  - El mapa offline (cdmx.pmtiles, 28 MB) se guarda la primera vez que abres
 *    el mapa con internet, y luego se sirve del teléfono.
 *  - pmtiles pide el mapa por FRAGMENTOS (Range requests). El navegador no deja
 *    cachear respuestas 206, así que guardamos el archivo COMPLETO una vez y
 *    aquí cortamos el fragmento pedido y devolvemos un 206 sintético.
 *
 * Todas las rutas se arman a partir de BASE (la carpeta donde vive este sw),
 * así la app funciona igual en la raíz del dominio que en /ruta650/.
 *
 * Sube CACHE_VERSION para forzar limpieza tras un cambio.
 */
const CACHE_VERSION = 'v6'
const CACHE = `ruta650-${CACHE_VERSION}`

// Carpeta de la app, con barra final. p. ej. "/" o "/ruta650/".
const BASE = new URL('./', self.location.href).pathname
const PMTILES = `${BASE}cdmx.pmtiles`

// Esqueleto que se guarda al instalar (archivos chicos y estables).
const SHELL = [
  '',
  'index.html',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
  'assets/ios.css',
  'sprites/light.json',
  'sprites/light.png',
  'sprites/light@2x.json',
  'sprites/light@2x.png',
  'fonts/Noto%20Sans%20Regular/0-255.pbf',
  'fonts/Noto%20Sans%20Regular/256-511.pbf',
  'fonts/Noto%20Sans%20Medium/0-255.pbf',
  'fonts/Noto%20Sans%20Medium/256-511.pbf',
  'fonts/Noto%20Sans%20Italic/0-255.pbf',
  'fonts/Noto%20Sans%20Italic/256-511.pbf',
].map((p) => BASE + p)

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // best-effort: si falla algún archivo, no rompemos la instalación
      Promise.allSettled(SHELL.map((u) => cache.add(u)))
    )
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// Buffer del mapa en memoria (se repuebla si el SW se reinicia).
let pmBuf = null
async function getPmtilesBuffer() {
  if (pmBuf) return pmBuf
  const cache = await caches.open(CACHE)
  let res = await cache.match(PMTILES)
  if (!res) {
    // Primera vez (con internet): bajar el archivo completo y guardarlo.
    res = await fetch(PMTILES)
    if (res && res.ok) await cache.put(PMTILES, res.clone())
  }
  if (!res || !res.ok) return null
  pmBuf = await res.arrayBuffer()
  return pmBuf
}

async function handlePmtiles(request) {
  const buf = await getPmtilesBuffer()
  if (!buf) return fetch(request) // sin cache y sin red: que falle normal
  const range = request.headers.get('range')
  if (!range) {
    return new Response(buf, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } })
  }
  const m = /bytes=(\d+)-(\d*)/.exec(range)
  const start = parseInt(m[1], 10)
  const end = m[2] ? parseInt(m[2], 10) : buf.byteLength - 1
  const slice = buf.slice(start, end + 1)
  return new Response(slice, {
    status: 206,
    headers: {
      'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`,
      'Content-Length': String(slice.byteLength),
      'Accept-Ranges': 'bytes',
      'Content-Type': 'application/octet-stream',
    },
  })
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Mapa offline: manejo especial de fragmentos.
  if (url.pathname === PMTILES) {
    event.respondWith(handlePmtiles(request))
    return
  }

  // Navegación: red primero, si no hay red cae al index cacheado.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(`${BASE}index.html`).then((r) => r || caches.match(BASE))
      )
    )
    return
  }

  // Resto (JS/CSS/fuentes/sprites/íconos): cache-first con revalidación.
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(request).then((cached) => {
        const net = fetch(request)
          .then((res) => {
            if (res && res.status === 200) cache.put(request, res.clone())
            return res
          })
          .catch(() => cached)
        return cached || net
      })
    )
  )
})
