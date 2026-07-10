import pluginVue from 'eslint-plugin-vue'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{ts,mts,tsx,vue}']
  },
  {
    name: 'app/files-to-ignore',
    ignores: [
      '**/dist/**',
      '**/dist-ssr/**',
      '**/coverage/**',
      '**/libs/**',
      '**/tablemate/**',
      '**/tabula/**'
    ]
  },
  pluginVue.configs['flat/essential'],
  {
    rules: {
      'vue/no-multiple-template-root': 'error',
      // Underscore-prefixed parameters are positional placeholders (kept to
      // preserve argument order at call sites) — don't flag them as unused.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  vueTsConfigs.recommended,
  skipFormatting
)
