import { ref } from 'vue'

export const THEMES = ['default'] as const
export type Theme = (typeof THEMES)[number]

const STORAGE_KEY = 'tm-theme'
// Sentinel persisted when the user explicitly picks "None" — distinguishes
// that choice from "never set" (which should default to 'default').
const NONE_SENTINEL = 'none'
const activeTheme = ref<Theme | null>(null)

function applyTheme(theme: Theme | null) {
  THEMES.forEach((t) => document.body.classList.remove(`theme-${t}`))
  if (theme) {
    document.body.classList.add(`theme-${theme}`)
    localStorage.setItem(STORAGE_KEY, theme)
  } else {
    localStorage.setItem(STORAGE_KEY, NONE_SENTINEL)
  }
}

export function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEY)
  let theme: Theme | null
  if (saved === null) theme = 'default' // never set → default theme
  else if (saved === NONE_SENTINEL) theme = null // explicit "no theme"
  else if ((THEMES as readonly string[]).includes(saved)) theme = saved as Theme
  else theme = 'default' // unknown legacy value → reset to default
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
