// Tailwind v4 compiles to oklch() colours, color-mix() and cascade layers.
// @layer is the dangerous one: an engine that doesn't recognise the at-rule
// discards its entire block, and Tailwind wraps nearly the whole sheet in
// layers — so an old WebView paints bare DOM on a white page rather than
// degrading gracefully. That is indistinguishable from a broken build unless
// the app says otherwise, which is the only reason this check exists.
//
// The floor is Chromium 111 (Tailwind v4's stated baseline). For reference,
// MuMuPlayer ships WebView 95, where the whole stylesheet is dropped.
//
// oklch() is the probe: it shares the 111 baseline with color-mix() and sits
// above cascade layers (99), so supporting it implies support for the rest.
export function supportsModernCss(): boolean {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false
  return CSS.supports('color', 'oklch(0 0 0)')
}
