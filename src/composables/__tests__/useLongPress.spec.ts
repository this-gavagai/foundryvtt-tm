// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { effectScope } from 'vue'
import { useLongPress } from '@/composables/useLongPress'

// Run the composable inside an effect scope so its onScopeDispose registers
// cleanly (and can be torn down between tests).
function setup(
  onLongPress: (e: PointerEvent) => void,
  options?: Parameters<typeof useLongPress>[1]
) {
  const scope = effectScope()
  const handlers = scope.run(() => useLongPress(onLongPress, options))!
  return { handlers, dispose: () => scope.stop() }
}

const touch = (over: Partial<PointerEvent> = {}) =>
  ({ pointerType: 'touch', clientX: 0, clientY: 0, currentTarget: null, ...over }) as PointerEvent

let scopes: Array<() => void> = []
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  scopes.forEach((s) => s())
  scopes = []
  vi.useRealTimers()
})

describe('useLongPress', () => {
  it('fires after the duration when a touch is held still', () => {
    const fn = vi.fn()
    const { handlers, dispose } = setup(fn, { durationMs: 450 })
    scopes.push(dispose)
    handlers.onPointerdown(touch())
    vi.advanceTimersByTime(449)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('ignores non-touch (mouse/pen) input', () => {
    const fn = vi.fn()
    const { handlers, dispose } = setup(fn)
    scopes.push(dispose)
    handlers.onPointerdown(touch({ pointerType: 'mouse' }))
    vi.advanceTimersByTime(1000)
    expect(fn).not.toHaveBeenCalled()
  })

  it('cancels when the finger moves past the threshold (scroll)', () => {
    const fn = vi.fn()
    const { handlers, dispose } = setup(fn, { moveThreshold: 10 })
    scopes.push(dispose)
    handlers.onPointerdown(touch({ clientX: 0, clientY: 0 }))
    handlers.onPointermove(touch({ clientX: 0, clientY: 40 }))
    vi.advanceTimersByTime(1000)
    expect(fn).not.toHaveBeenCalled()
  })

  it('cancels on pointerup before the duration elapses', () => {
    const fn = vi.fn()
    const { handlers, dispose } = setup(fn)
    scopes.push(dispose)
    handlers.onPointerdown(touch())
    handlers.onPointerup()
    vi.advanceTimersByTime(1000)
    expect(fn).not.toHaveBeenCalled()
  })

  it('does nothing when disabled', () => {
    const fn = vi.fn()
    const { handlers, dispose } = setup(fn, { enabled: () => false })
    scopes.push(dispose)
    handlers.onPointerdown(touch())
    vi.advanceTimersByTime(1000)
    expect(fn).not.toHaveBeenCalled()
  })

  it('swallows the whole release mouse-compat burst on the pressed element', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const { handlers, dispose } = setup(() => {})
    scopes.push(() => {
      dispose()
      el.remove()
    })

    handlers.onPointerdown(touch({ currentTarget: el }))
    vi.advanceTimersByTime(500)

    // The release touchend + compat mouse burst (target within the pressed
    // element) are all swallowed — touchend is what Headless's outside handler
    // uses to close the just-opened menu on touch devices.
    for (const type of ['touchend', 'mousedown', 'mouseup', 'click'] as const) {
      const ghost = new Event(type, { bubbles: true, cancelable: true })
      el.dispatchEvent(ghost)
      expect(ghost.defaultPrevented, type).toBe(true)
    }
  })

  it('does not swallow a tap elsewhere (e.g. on the opened menu)', () => {
    const el = document.createElement('div')
    const outside = document.createElement('div')
    document.body.append(el, outside)
    const { handlers, dispose } = setup(() => {})
    scopes.push(() => {
      dispose()
      el.remove()
      outside.remove()
    })

    handlers.onPointerdown(touch({ currentTarget: el }))
    vi.advanceTimersByTime(500)

    const tap = new MouseEvent('click', { bubbles: true, cancelable: true })
    outside.dispatchEvent(tap)
    expect(tap.defaultPrevented).toBe(false)
  })

  it('stops suppressing after the window elapses', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const { handlers, dispose } = setup(() => {})
    scopes.push(() => {
      dispose()
      el.remove()
    })

    handlers.onPointerdown(touch({ currentTarget: el }))
    vi.advanceTimersByTime(500) // fire
    vi.advanceTimersByTime(500) // suppression window elapses

    const later = new MouseEvent('click', { bubbles: true, cancelable: true })
    el.dispatchEvent(later)
    expect(later.defaultPrevented).toBe(false)
  })

  // WebKit answers a long-press on a `user-select: none` target by selecting the
  // nearest selectable ANCESTOR instead — which looked like "the whole screen got
  // selected" when pressing a reaction chip. So selectstart is cancelled wherever
  // it fires, not only inside the pressed element.
  describe('text selection', () => {
    it('cancels a selection starting outside the pressed element', () => {
      const el = document.createElement('div')
      const ancestor = document.createElement('div')
      ancestor.appendChild(el)
      document.body.appendChild(ancestor)
      const { handlers, dispose } = setup(() => {})
      scopes.push(() => {
        dispose()
        ancestor.remove()
      })

      handlers.onPointerdown(touch({ currentTarget: el }))
      vi.advanceTimersByTime(500)

      // Fired on the ancestor: a containment check against the pressed element
      // would let this through, which is the bug.
      const selectStart = new Event('selectstart', { bubbles: true, cancelable: true })
      ancestor.dispatchEvent(selectStart)
      expect(selectStart.defaultPrevented).toBe(true)
    })

    it('stops cancelling selections once the window elapses', () => {
      const el = document.createElement('div')
      document.body.appendChild(el)
      const { handlers, dispose } = setup(() => {})
      scopes.push(() => {
        dispose()
        el.remove()
      })

      handlers.onPointerdown(touch({ currentTarget: el }))
      vi.advanceTimersByTime(500) // fire
      vi.advanceTimersByTime(500) // suppression window elapses

      const later = new Event('selectstart', { bubbles: true, cancelable: true })
      el.dispatchEvent(later)
      expect(later.defaultPrevented).toBe(false)
    })

    it('clears a selection the press had already established', () => {
      const el = document.createElement('div')
      document.body.appendChild(el)
      const removeAllRanges = vi.fn()
      const getSelection = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue({ isCollapsed: false, removeAllRanges } as unknown as Selection)
      const { handlers, dispose } = setup(() => {})
      scopes.push(() => {
        dispose()
        el.remove()
        getSelection.mockRestore()
      })

      handlers.onPointerdown(touch({ currentTarget: el }))
      vi.advanceTimersByTime(500)
      expect(removeAllRanges).toHaveBeenCalled()
    })

    it('leaves an already-collapsed selection alone', () => {
      const el = document.createElement('div')
      document.body.appendChild(el)
      const removeAllRanges = vi.fn()
      const getSelection = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue({ isCollapsed: true, removeAllRanges } as unknown as Selection)
      const { handlers, dispose } = setup(() => {})
      scopes.push(() => {
        dispose()
        el.remove()
        getSelection.mockRestore()
      })

      handlers.onPointerdown(touch({ currentTarget: el }))
      vi.advanceTimersByTime(500)
      expect(removeAllRanges).not.toHaveBeenCalled()
    })
  })
})
