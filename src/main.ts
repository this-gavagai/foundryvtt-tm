import './main.css'
import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import { i18n } from '@/plugins/i18n'

import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import { initImageCache } from '@/api/imageCache'

window.__TM_ENV__ = {
  MODE: import.meta.env.MODE,
  DEV: import.meta.env.DEV,
  PROD: import.meta.env.PROD
}

async function bootstrap() {
  if (Capacitor.isNativePlatform()) {
    // Lay the WebView out below the status bar instead of under it, so no app
    // content (sheet, side menu, overlays) can extend into / block the status
    // bar. The exposed strip matches the dark theme background; light text/icons
    // (Style.Dark) sit on top. Errors are swallowed so a missing plugin never
    // blocks startup. Color is set before toggling overlay so the strip paints
    // dark immediately rather than flashing the plugin's default black. These are
    // fire-and-forget — they must not delay the index await or the first paint.
    StatusBar.setBackgroundColor({ color: '#181d25' }).catch(() => {})
    StatusBar.setStyle({ style: Style.Dark }).catch(() => {})
    StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {})

    // Await the on-disk image cache index *before* the first render so a
    // previously cached asset (portrait, icon) resolves to its local file:// copy
    // on first paint, instead of racing the render: a miss returns the remote URL
    // and only swaps to the cached file after a background re-render, which costs
    // a network fetch + a second image load every launch. The readdir is fast and
    // initImageCache never rejects — an empty/unreadable cache just falls back to
    // lazy population, so this can only delay mount by a quick directory listing.
    await initImageCache()
  }

  const pinia = createPinia()
  const app = createApp(App)

  app.use(i18n)
  app.use(pinia)

  app.mount('#app')
}

void bootstrap()
