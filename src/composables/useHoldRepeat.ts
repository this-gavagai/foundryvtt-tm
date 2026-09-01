import { onScopeDispose, ref } from 'vue'

// Press-and-hold repeat for a stepper button, with acceleration.
//
// The first press fires immediately, so a tap is still a tap. Holding past
// `delayMs` starts repeating, and the interval ramps from `startIntervalMs`
// down to `minIntervalMs` over `rampMs` — slow enough at the start to land on
// an exact number, fast enough after a second to cross a hundred coins without
// the player thinking about it. Unlike useLongPress this accepts mouse and pen
// as well as touch: the same button is used on a desktop browser.
//
// Release is watched on the window rather than the button, so a finger that
// slides off mid-hold still stops the repeat instead of running away.
export function useHoldRepeat(
  fire: () => void,
  options: {
    delayMs?: number
    startIntervalMs?: number
    minIntervalMs?: number
    rampMs?: number
    enabled?: () => boolean
  } = {}
) {
  const delayMs = options.delayMs ?? 400
  const startIntervalMs = options.startIntervalMs ?? 180
  const minIntervalMs = options.minIntervalMs ?? 45
  const rampMs = options.rampMs ?? 1400

  const holding = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  let heldSince = 0

  function interval() {
    const progress = Math.min(1, (performance.now() - heldSince - delayMs) / rampMs)
    return startIntervalMs + (minIntervalMs - startIntervalMs) * progress
  }

  function tick() {
    if (options.enabled && !options.enabled()) return stop()
    fire()
    timer = setTimeout(tick, interval())
  }

  function stop() {
    if (timer) clearTimeout(timer)
    timer = undefined
    holding.value = false
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }

  function start(event: PointerEvent) {
    // Only the primary button, and never a second pointer while one is held.
    if (event.button !== 0 || timer) return
    if (options.enabled && !options.enabled()) return
    fire()
    holding.value = true
    heldSince = performance.now()
    timer = setTimeout(tick, delayMs)
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerup', stop)
      window.addEventListener('pointercancel', stop)
    }
  }

  onScopeDispose(stop)

  return { holding, start, stop }
}
