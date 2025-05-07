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
      '**/tabula/**',
      // TODO (types): remove this line. it's just there for now while my types files are such a mess.
      '**/types/**'
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
