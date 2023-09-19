import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
  base: '/modules/keybard/dist/',
  plugins: [
    vue()
    // VitePWA({
    //   registerType: 'autoUpdate',
    //   includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
    //   manifest: {
    //     name: 'My Awesome App',
    //     short_name: 'MyApp',
    //     description: 'My Awesome App description',
    //     theme_color: '#ffffff',
    //     display: 'standalone',
    //     // scope: 'http://192.168.2.147',
    //     icons: [
    //       {
    //         src: 'pwa-192x192.png',
    //         sizes: '192x192',
    //         type: 'image/png'
    //       },
    //       {
    //         src: 'pwa-512x512.png',
    //         sizes: '512x512',
    //         type: 'image/png'
    //       }
    //     ]
    //   }
    // })
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
  // server: {
  //   cors: true,
  //   proxy: {
  //     '/join': {
  //       target: 'http://localhost:30000/',
  //       changeOrigin: true,
  //       secure: false
  //       // rewrite: (path) => path.replace(/^\/api/, '')
  //     }
  //     // '/join': 'http://192.168.2.176:30000/join'
  //   }
  // }
})
