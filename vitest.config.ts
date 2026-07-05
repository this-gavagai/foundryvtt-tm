import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

// Standalone config (rather than reusing vite.config.mts) so tests don't drag
// in the PWA plugin or the mode-dependent build settings.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    include: ['src/**/__tests__/*.spec.ts']
  }
})
