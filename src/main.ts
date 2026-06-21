import './main.css'
import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import { i18n } from '@/plugins/i18n'

import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import { initImageCache } from '@/api/imageCache'

if (Capacitor.isNativePlatform()) {
  // Repopulate the on-disk image cache index before first render so previously
  // cached assets serve from disk instead of re-downloading. Failures fall back
  // to lazy population and never block startup.
  void initImageCache()

  // Lay the WebView out below the status bar instead of under it, so no app
  // content (sheet, side menu, overlays) can extend into / block the status
  // bar. The exposed strip matches the dark theme background; light text/icons
  // (Style.Dark) sit on top. Errors are swallowed so a missing plugin never
  // blocks startup. Color is set before toggling overlay so the strip paints
  // dark immediately rather than flashing the plugin's default black.
  StatusBar.setBackgroundColor({ color: '#181d25' }).catch(() => {})
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {})
  StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {})
}

window.__TM_ENV__ = {
  MODE: import.meta.env.MODE,
  DEV: import.meta.env.DEV,
  PROD: import.meta.env.PROD
}

const pinia = createPinia()
const app = createApp(App)

app.use(i18n)
app.use(pinia)

app.mount('#app')
