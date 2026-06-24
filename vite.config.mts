import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// App version baked into the bundle for the module/app handshake. CI sets the
// git tag via APP_VERSION before building (see build-and-release.yml); locally
// it falls back to package.json so dev builds carry a stable, recognizable value.
const pkgVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
  .version
const appVersion = process.env.APP_VERSION ?? pkgVersion

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isCapacitor = mode === 'capacitor'
  return {
    base: isCapacitor ? './' : isCapacitor ? './' : '/modules/tablemate/',
    define: {
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'true',
      BUILD_MODE: JSON.stringify(mode),
      __APP_VERSION__: JSON.stringify(appVersion)
    },
    build: {
      outDir: isCapacitor ? 'dist' : isCapacitor ? 'dist' : 'tablemate',
      sourcemap: true,
      assetsInlineLimit: 8192, // bump to 8 KiB
      chunkSizeWarningLimit: 1000, // kB
      minify: true,
      rollupOptions: isCapacitor
        ? {
            input: ['index.html'],
            output: {
              manualChunks: (id) =>
                id.includes('@systemic-games/pixels-web-connect') ? 'pixel' : undefined
            }
          }
        : {
            input: ['index.html', 'src/foundry/tablemate.ts'],
            output: {
              entryFileNames: (chunk) => {
                if (chunk.facadeModuleId?.endsWith('tablemate.ts')) {
                  return 'tablemate.mjs'
                } else {
                  return 'assets/[name]-[hash].js'
                }
              },
              manualChunks: (id) =>
                id.includes('@systemic-games/pixels-web-connect') ? 'pixel' : undefined
            }
          }
    },
    plugins: [
      vue(),
      VitePWA({
        disable: isCapacitor,
        // 'prompt' surfaces an explicit "new version" banner via
        // useRegisterSW so mid-session updates are visible to the user instead
        // of silently swapping on next navigation. See UpdatePrompt.vue.
        registerType: 'prompt',
        includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'maskable-icon-512x512.png'],
        // PWA stays off in dev: the dev server emits Vite-mangled paths
        // (/node_modules/.vite/deps/...?v=hash, /src/*.ts, /@id/__x00__...)
        // that don't exist in the precache manifest, so workbox spams
        // "no route found" warnings on every reload. The PWA is only
        // useful against a production build anyway.
        devOptions: {
          enabled: false
        },
        manifest: {
          name: 'Tabula Mensa',
          short_name: 'Tabula Mensa',
          description: 'A PF2e Character Sheet for FoundryVTT',
          theme_color: '#ffffff',
          start_url: '/modules/tablemate/index.html',
          scope: '/modules/tablemate/',
          icons: [
            {
              src: 'pwa-64x64.png',
              sizes: '64x64',
              type: 'image/png'
            },
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: 'maskable-icon-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable'
            }
          ],
          screenshots: [
            {
              src: 'screenshots/wide.png',
              sizes: '1280x720',
              type: 'image/png',
              form_factor: 'wide',
              label: 'Character sheet front page'
            },
            {
              src: 'screenshots/narrow.png',
              sizes: '780x1688',
              type: 'image/png',
              form_factor: 'narrow',
              platform: 'ios',
              label: 'Character sheet mobile view'
            }
          ]
        },
        workbox: {
          // Serve index.html for any navigation request within the app scope.
          // Without this, a hard refresh or PWA cold-launch to /modules/tablemate
          // (no trailing slash, no filename) falls through to the Foundry server
          // which returns 404 for that bare path.
          navigateFallback: '/modules/tablemate/index.html',
          navigateFallbackAllowlist: [/^\/modules\/tablemate/],
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.destination === 'image',
              handler: 'CacheFirst',
              options: {
                cacheName: 'images',
                expiration: {
                  maxEntries: 300,
                  maxAgeSeconds: 90 * 24 * 60 * 60 // 60 days
                }
              }
            }
          ]
        }
      })
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    server: {
      port: 30001,
      open: '/',
      proxy: {
        '/modules/tablemate/tablemate.mjs': 'http://localhost:30000/',
        '^/modules/tablemate/assets/': 'http://localhost:30000/',
        '^(?!/modules/tablemate/)': 'http://localhost:30000/',
        '/socket.io': {
          target: 'ws://localhost:30000',
          ws: true
        }
      }
    }
  }
})
