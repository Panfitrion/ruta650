import { createApp } from 'vue'
import './style.css'
import App from './App.vue'

createApp(App).mount('#app')

// PWA: registrar el service worker (solo en producción / build servido).
// En dev de Vite no se registra para no interferir con el hot-reload.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // Cuando el service worker nuevo toma control, recargar una vez para
  // aplicar la versión nueva automáticamente (evita quedarse con la vieja).
  let refreshing = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return
    refreshing = true
    window.location.reload()
  })

  window.addEventListener('load', async () => {
    try {
      // updateViaCache:'none' → siempre busca sw.js fresco (no del caché HTTP)
      // Ruta relativa al index.html: el scope del SW queda en la carpeta de la
      // app, funcione en la raíz del dominio o en un subdirectorio.
      const swUrl = new URL('sw.js', document.baseURI).href
      const reg = await navigator.serviceWorker.register(swUrl, { updateViaCache: 'none' })
      reg.update()
      // revisar si hay versión nueva cada vez que vuelves a la app
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update()
      })
    } catch (err) {
      console.warn('SW registro falló:', err)
    }
  })
}
