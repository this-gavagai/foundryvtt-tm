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

// `selectstart` is suppressed too, but UNSCOPED — unlike the events above, which
// are only swallowed when they originate inside the pressed element.
//
// The reason is how WebKit handles a long-press on a `user-select: none` target:
// rather than selecting nothing, it walks UP to the nearest selectable ancestor
// and selects that instead — which is why pressing a reaction chip could select
// what looked like the whole screen. The resulting `selectstart` fires on that
// ancestor, not on the pressed element, so a containment check would let it
// through. Nobody is legitimately starting a selection in the ~500ms after a
// deliberate long-press, so it is cancelled outright for the window.
const SELECTION_EVENT = 'selectstart'

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

  // Cancel a selection outright, wherever it was starting (see SELECTION_EVENT).
  function swallowSelection(event: Event) {
    event.preventDefault()
    event.stopPropagation()
  }

  // Drop a selection that WebKit already established before suppression began —
  // preventing selectstart stops a new one, but the press may have set one first
  // (its timing sits right around ours), leaving the page highlighted.
  function clearExistingSelection() {
    if (typeof window === 'undefined') return
    const selection = window.getSelection?.()
    if (selection && !selection.isCollapsed) selection.removeAllRanges()
  }

  function beginSuppression() {
    if (typeof window === 'undefined') return
    if (!suppressing) {
      for (const type of SUPPRESSED_EVENTS) window.addEventListener(type, swallow, true)
      window.addEventListener(SELECTION_EVENT, swallowSelection, true)
      suppressing = true
    }
    if (suppressTimer) clearTimeout(suppressTimer)
    suppressTimer = setTimeout(endSuppression, 500)
  }

  function endSuppression() {
    if (typeof window !== 'undefined' && suppressing) {
      for (const type of SUPPRESSED_EVENTS) window.removeEventListener(type, swallow, true)
      window.removeEventListener(SELECTION_EVENT, swallowSelection, true)
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
      clearExistingSelection()
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
