import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// Standalone config (rather than reusing vite.config.mts) so tests don't drag
// in the PWA plugin or the mode-dependent build settings.
//
// The vue plugin is here so a spec can MOUNT a component. Most of the suite
// tests composables and pure utilities, which need none of it — but a decision
// that only exists in a template (which affordance a missing GM hides, whether
// Delete is offered on a message) had no way to be pinned at all, and those are
// exactly the decisions that were being got wrong. See utils/mountComponent.ts.
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    include: ['src/**/__tests__/*.spec.ts']
  }
})
