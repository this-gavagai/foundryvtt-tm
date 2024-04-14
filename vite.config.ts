import { fileURLToPath, URL } from 'node:url'
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
          }
        }
      }
    },
    plugins: [vue()],
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
        '^(?!/modules/tablemate/)': 'http://localhost:30000/',
        '/socket.io': {
          target: 'ws://localhost:30000',
          ws: true
        }
      }
    }
  }
})
