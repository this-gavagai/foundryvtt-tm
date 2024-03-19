import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import FullReload from 'vite-plugin-full-reload'

// https://vitejs.dev/config/
export default defineConfig({
  base: '/modules/tablemate/',
  // base: '/',
  build: {
    outDir: 'tablemate',
    sourcemap: true,
    minify: true,
    watch: {
      clearScreen: true
    }
  },
  plugins: [vue(), FullReload(['./public/scripts/*.mjs'])],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
})
