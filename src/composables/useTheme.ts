import { ref } from 'vue'

export const THEMES = ['default'] as const
export type Theme = (typeof THEMES)[number]

const STORAGE_KEY = 'tm-theme'
const activeTheme = ref<Theme | null>(null)

function applyTheme(theme: Theme | null) {
  THEMES.forEach((t) => document.body.classList.remove(`theme-${t}`))
  if (theme) {
    document.body.classList.add(`theme-${theme}`)
    localStorage.setItem(STORAGE_KEY, theme)
  } else {
    localStorage.removeItem(STORAGE_KEY)
  }
}

export function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEY) as Theme | null
  const theme = saved && (THEMES as readonly string[]).includes(saved) ? (saved as Theme) : 'default'
  activeTheme.value = theme
  applyTheme(theme)
}

export function useTheme() {
  function setTheme(theme: string | null) {
    const validated =
      theme && (THEMES as readonly string[]).includes(theme) ? (theme as Theme) : null
    activeTheme.value = validated
    applyTheme(validated)
  }

  return { activeTheme, setTheme, themes: THEMES }
}
