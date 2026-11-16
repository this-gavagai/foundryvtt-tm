import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'io.github.thisgavagai.tablemate',
  appName: 'Tabula Mensa',
  webDir: 'dist',
  android: {
    // The Android WebView serves the app from https://localhost, and its default
    // mixed-content policy refuses every http:// subresource — while self-hosted
    // Foundry servers are commonly plain http on a LAN IP. Anything the WebView
    // loads straight from the server (a GM's shared image, voice memos, an
    // icon's first view before the image cache lands it) would otherwise stay
    // blank. Native requests are covered separately by usesCleartextTraffic in
    // the manifest.
    allowMixedContent: true
  }
}

export default config
