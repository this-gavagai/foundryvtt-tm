import { ref } from 'vue'

import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'

import { THEMES, type ThemeOption } from '@/themes'

export { THEMES }

// A theme id is 'moonlit' or, for a variant, 'moonlit/coolblue'. The list is
// filesystem-derived (src/themes/index.ts), which also loads the stylesheets.
export type Theme = string

const themeById = new Map<string, ThemeOption>(THEMES.map((t) => [t.id, t]))

const DEFAULT_THEME = 'moonlit'
const STORAGE_KEY = 'tm-theme'
// Sentinel persisted when the user explicitly picks "None" — distinguishes
// that choice from "never set" (which should default to DEFAULT_THEME).
const NONE_SENTINEL = 'none'
const activeTheme = ref<Theme | null>(null)

// Normalize an arbitrary stored/requested id to a known theme id, or null.
// An unknown tail degrades to the nearest existing prefix rather than
// discarding the whole choice (e.g. a variant removed between sessions:
// 'moonlit/coolblue' → 'moonlit').
function validateTheme(id: string | null): Theme | null {
  if (!id) return null
  const segments = id.split('/')
  while (segments.length) {
    const candidate = segments.join('/')
    if (themeById.has(candidate)) return candidate
    segments.pop()
  }
  return null
}

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

function applyTheme(id: Theme | null) {
  for (const cls of [...document.body.classList]) {
    if (cls.startsWith('theme-') || cls.startsWith('variant-') || cls.startsWith('base-'))
      document.body.classList.remove(cls)
  }
  if (id) {
    for (const cls of themeById.get(id)?.classes ?? []) document.body.classList.add(cls)
    localStorage.setItem(STORAGE_KEY, id)
  } else {
    localStorage.setItem(STORAGE_KEY, NONE_SENTINEL)
  }
  syncNativeStatusBar()
}

export function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEY)
  let theme: Theme | null
  if (saved === null)
    theme = DEFAULT_THEME // never set → default theme
  else if (saved === NONE_SENTINEL)
    theme = null // explicit "no theme"
  // unknown/legacy value (e.g. old 'default') → default theme
  else theme = validateTheme(saved) ?? DEFAULT_THEME
  activeTheme.value = theme
  applyTheme(theme)
}

export function useTheme() {
  function setTheme(theme: string | null) {
    const validated = validateTheme(theme)
    activeTheme.value = validated
    applyTheme(validated)
  }

  return { activeTheme, setTheme, themes: THEMES }
}
