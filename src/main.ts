import './main.css'
import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import { i18n } from '@/plugins/i18n'

import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import { initImageCache } from '@/api/imageCache'

if (Capacitor.isNativePlatform()) {
  // Marks the build as native so the status-bar-overlay layout rules in
  // main.css (which pad the top-touching surfaces by env(safe-area-inset-top))
  // apply only here, never on the web build.
  document.documentElement.classList.add('tm-native')

  // Repopulate the on-disk image cache index before first render so previously
  // cached assets serve from disk instead of re-downloading. Failures fall back
  // to lazy population and never block startup.
  void initImageCache()

  // Let the WebView extend *under* the status bar so the sheet's themed
  // background + gradient flow continuously up through the strip — a seamless
  // top rather than a separate solid band. App content (sheet, side menu,
  // overlays) is kept clear of the status bar by the env(safe-area-inset-top)
  // inset on #app / ChatOverlay (see main.css). On Android the status-bar
  // background is made transparent so the gradient shows through; iOS ignores
  // setBackgroundColor and is always transparent in overlay mode. Errors are
  // swallowed so a missing plugin never blocks startup.
  //
  // The icon/text style is theme-driven (syncNativeStatusBar in useTheme):
  // initTheme() runs during first render and flips it to suit the active
  // theme's background luminance. Style.Dark (light icons) below is only a
  // pre-paint placeholder matching the common dark theme.
  StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {})
  StatusBar.setBackgroundColor({ color: '#00000000' }).catch(() => {})
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {})
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
