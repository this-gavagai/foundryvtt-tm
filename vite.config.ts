import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import FullReload from 'vite-plugin-full-reload'
import generateFile from 'vite-plugin-generate-file'

// https://vitejs.dev/config/
export default defineConfig({
  base: '/modules/tablemate/',
  // base: '/',
  build: {
    outDir: 'tablemate',
    sourcemap: true,
    minify: true
  },
  plugins: [
    vue(),
    FullReload(['./public/scripts/*.mjs'])
    // generateFile
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
})
