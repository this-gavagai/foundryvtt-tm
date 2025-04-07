import { fileURLToPath, URL } from 'node:url'
// import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  console.log(mode)
  return {
    base: '/modules/tablemate/',
    define: {
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'true',
      BUILD_MODE: JSON.stringify(mode)
    },
    build: {
      outDir: 'tablemate',
      sourcemap: true,
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
      vue()
      // VitePWA({
      //   registerType: 'autoUpdate',
      //   includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'maskable-icon-512x512.png'],
      //   devOptions: {
      //     enabled: true
      //   },
      //   manifest: {
      //     name: 'Tabula Mensa',
      //     short_name: 'Tabula Mensa',
      //     description: 'A PF2e Character Sheet for FoundryVTT',
      //     theme_color: '#ffffff',
      //     icons: [
      //       {
      //         src: 'pwa-64x64.png',
      //         sizes: '64x64',
      //         type: 'image/png'
      //       },
      //       {
      //         src: 'pwa-192x192.png',
      //         sizes: '192x192',
      //         type: 'image/png'
      //       },
      //       {
      //         src: 'pwa-512x512.png',
      //         sizes: '512x512',
      //         type: 'image/png',
      //         purpose: 'any'
      //       },
      //       {
      //         src: 'maskable-icon-512x512.png',
      //         sizes: '512x512',
      //         type: 'image/png',
      //         purpose: 'maskable'
      //       }
      //     ],
      //     screenshots: [
      //       {
      //         src: 'screenshots/wide.png',
      //         sizes: '1280x720',
      //         type: 'image/png',
      //         form_factor: 'wide',
      //         label: 'Character sheet front page'
      //       },
      //       {
      //         src: 'screenshots/narrow.png',
      //         sizes: '780x1688',
      //         type: 'image/png',
      //         form_factor: 'narrow',
      //         platform: 'ios',
      //         label: 'Character sheet mobile view'
      //       }
      //     ]
      //   },
      //   workbox: {
      //     runtimeCaching: [
      //       {
      //         urlPattern: ({ request }) =>
      //           request.destination === 'style' ||
      //           request.destination === 'script' ||
      //           request.destination === 'worker',
      //         handler: 'StaleWhileRevalidate',
      //         options: {
      //           cacheName: 'static-resources',
      //           expiration: {
      //             maxEntries: 50,
      //             maxAgeSeconds: 30 * 24 * 60 * 60 // 30 days
      //           }
      //         }
      //       },
      //       {
      //         urlPattern: ({ request }) => request.destination === 'image',
      //         handler: 'CacheFirst',
      //         options: {
      //           cacheName: 'images',
      //           expiration: {
      //             maxEntries: 300,
      //             maxAgeSeconds: 90 * 24 * 60 * 60 // 60 days
      //           }
      //         }
      //       }
      //     ]
      //   }
      // })
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
        '^/modules/tablemate/assets/actions.*': 'http://localhost:30000/',
        '^/modules/tablemate/assets/debounce*': 'http://localhost:30000/',
        '^(?!/modules/tablemate/)': 'http://localhost:30000/',
        '/socket.io': {
          target: 'ws://localhost:30000',
          ws: true
        }
      }
    }
  }
})
