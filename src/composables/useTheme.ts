import { ref } from 'vue'

import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'

export const THEMES = ['moonlit', 'sunny'] as const
export type Theme = (typeof THEMES)[number]

const STORAGE_KEY = 'tm-theme'
// Sentinel persisted when the user explicitly picks "None" — distinguishes
// that choice from "never set" (which should default to 'moonlit').
const NONE_SENTINEL = 'none'
const activeTheme = ref<Theme | null>(null)

// Resolve any CSS color string to sRGB bytes via a 1×1 canvas. We can't parse
// getComputedStyle's output ourselves: WebKit returns oklch() backgrounds in a
// non-rgb() form (oklab()/color(srgb …)), so a naive numeric parse reads the
// fractional channels as the color and computes a bogus luminance. The canvas
// does the conversion the same way the renderer does. Returns null if the 2D
// context is unavailable.
function toSrgb(color: string): [number, number, number] | null {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return [r, g, b]
}

// The WebView underlaps the status bar (overlay mode — see main.ts), so the
// active theme's body background + gradient already fill the strip continuously.
// We don't paint the strip a solid color; we only flip the icon/text style so
// it stays legible against whatever the theme renders there. Style is chosen by
// the body background's perceived luminance — measured from the *computed*
// color rather than hard-coded per theme, so it tracks any future theme: dark
// icons on light backgrounds (Style.Light), light icons on dark ones
// (Style.Dark).
function syncNativeStatusBar() {
  if (!Capacitor.isNativePlatform()) return
  const rgb = toSrgb(getComputedStyle(document.body).backgroundColor)
  if (!rgb) return
  const [r, g, b] = rgb
  // Perceived (relative) luminance, sRGB coefficients.
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  StatusBar.setStyle({ style: luminance > 0.5 ? Style.Light : Style.Dark }).catch(() => {})
}

function applyTheme(theme: Theme | null) {
  THEMES.forEach((t) => document.body.classList.remove(`theme-${t}`))
  if (theme) {
    document.body.classList.add(`theme-${theme}`)
    localStorage.setItem(STORAGE_KEY, theme)
  } else {
    localStorage.setItem(STORAGE_KEY, NONE_SENTINEL)
  }
  syncNativeStatusBar()
}

export function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEY)
  let theme: Theme | null
  if (saved === null) theme = 'moonlit' // never set → default theme
  else if (saved === NONE_SENTINEL) theme = null // explicit "no theme"
  else if ((THEMES as readonly string[]).includes(saved)) theme = saved as Theme
  else theme = 'moonlit' // unknown/legacy value (e.g. old 'default') → moonlit
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
