import { onScopeDispose } from 'vue'

// Touch long-press detection. Fires `onLongPress` after the finger is held
// still for `durationMs`; cancels on lift, on movement past `moveThreshold`
// (so scrolling never triggers it), or on cancel. Pointer (mouse/pen) input is
// ignored — desktop uses hover affordances, not press-and-hold.
//
// Releasing a touch long-press fires `touchend` plus a full compatibility mouse
// burst (mousedown → mouseup → click, and sometimes contextmenu). Left alone
// these both activate whatever is under the finger AND are seen by
// document-level outside handlers, immediately closing a menu the long-press
// just opened. Notably Headless UI's outside-click closes on `touchend` on
// touch devices (its click path is desktop-only), which is why suppressing only
// the mouse events isn't enough. So on fire we briefly swallow the whole release
// burst at the window-capture level — before any document handler runs — scoped
// to the pressed element, so a tap on the freshly-opened menu is never eaten.
const SUPPRESSED_EVENTS = ['touchend', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu']

export function useLongPress(
  onLongPress: (event: PointerEvent) => void,
  options: { durationMs?: number; moveThreshold?: number; enabled?: () => boolean } = {}
) {
  const duration = options.durationMs ?? 450
  const moveThreshold = options.moveThreshold ?? 10

  let timer: ReturnType<typeof setTimeout> | undefined
  let suppressTimer: ReturnType<typeof setTimeout> | undefined
  let suppressing = false
  let pressEl: Node | null = null
  let startX = 0
  let startY = 0

  function clearTimer() {
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  // Swallow a trailing event only when it originates within the pressed element
  // (the ghost click/contextmenu on release) — never a tap on the teleported
  // menu, which lives elsewhere in the DOM.
  function swallow(event: Event) {
    if (pressEl && event.target instanceof Node && pressEl.contains(event.target)) {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }
  }

  function beginSuppression() {
    if (typeof window === 'undefined') return
    if (!suppressing) {
      for (const type of SUPPRESSED_EVENTS) window.addEventListener(type, swallow, true)
      suppressing = true
    }
    if (suppressTimer) clearTimeout(suppressTimer)
    suppressTimer = setTimeout(endSuppression, 500)
  }

  function endSuppression() {
    if (typeof window !== 'undefined' && suppressing) {
      for (const type of SUPPRESSED_EVENTS) window.removeEventListener(type, swallow, true)
    }
    suppressing = false
    if (suppressTimer) {
      clearTimeout(suppressTimer)
      suppressTimer = undefined
    }
  }

  function onPointerdown(event: PointerEvent) {
    if (event.pointerType !== 'touch') return
    if (options.enabled && !options.enabled()) return
    pressEl = event.currentTarget instanceof Node ? event.currentTarget : null
    startX = event.clientX
    startY = event.clientY
    clearTimer()
    timer = setTimeout(() => {
      timer = undefined
      beginSuppression()
      onLongPress(event)
    }, duration)
  }

  function onPointermove(event: PointerEvent) {
    if (!timer) return
    if (
      Math.abs(event.clientX - startX) > moveThreshold ||
      Math.abs(event.clientY - startY) > moveThreshold
    ) {
      clearTimer()
    }
  }

  function onPointerup() {
    clearTimer()
  }

  function onPointercancel() {
    clearTimer()
  }

  onScopeDispose(() => {
    clearTimer()
    endSuppression()
  })

  return { onPointerdown, onPointermove, onPointerup, onPointercancel }
}
