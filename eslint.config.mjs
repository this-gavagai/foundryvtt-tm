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
      'vue/no-multiple-template-root': 'error'
    }
  },
  vueTsConfigs.recommended,
  skipFormatting
)
