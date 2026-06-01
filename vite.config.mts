import { fileURLToPath, URL } from 'node:url'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  return {
    base: '/modules/tablemate/',
    define: {
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'true',
      BUILD_MODE: JSON.stringify(mode)
    },
    build: {
      outDir: 'tablemate',
      sourcemap: true,
      assetsInlineLimit: 8192, // bump to 8 KiB
      chunkSizeWarningLimit: 1000, // kB
      minify: true,
      rollupOptions: {
        input: ['index.html', 'src/foundry/tablemate.ts'],
        output: {
          entryFileNames: (chunk) => {
            if (chunk.facadeModuleId?.endsWith('tablemate.ts')) {
              return 'tablemate.mjs'
            } else {
              return 'assets/[name]-[hash].js'
            }
          },
          manualChunks: {
            pixel: ['@systemic-games/pixels-web-connect']
          }
        }
      }
    },
    plugins: [
      vue(),
      VitePWA({
        // 'prompt' surfaces an explicit "new version" banner via
        // useRegisterSW so mid-session updates are visible to the user instead
        // of silently swapping on next navigation. See UpdatePrompt.vue.
        registerType: 'prompt',
        includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'maskable-icon-512x512.png'],
        devOptions: {
          enabled: true
        },
        manifest: {
          name: 'Tabula Mensa',
          short_name: 'Tabula Mensa',
          description: 'A PF2e Character Sheet for FoundryVTT',
          theme_color: '#ffffff',
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
          // The precache (auto-generated from the build manifest) already
          // covers every JS/CSS/HTML asset we ship — runtime rules only matter
          // for resources fetched from outside the build. The single remaining
          // rule caches Foundry-served images (actor portraits, item icons
          // under /icons/, /worlds/...) since those are the real cold-load
          // bottleneck on tablets.
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
