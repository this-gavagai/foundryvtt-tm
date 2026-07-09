import { nextTick, onBeforeUnmount, ref } from 'vue'

// Scroll orchestration for the chat log: at-bottom tracking, landing on the
// unread divider when the overlay opens (and re-pinning while late-loading
// content settles), and the eased scroll-to-bottom used to follow new arrivals.
export function useChatScroll(options: { onAtBottom?: () => void } = {}) {
  const scrollContainer = ref<HTMLElement>()
  let scrollAnimationFrame: number | undefined
  // Re-pins the open position while late-loading content settles (see positionOnOpen).
  let openSettleObserver: ResizeObserver | undefined
  let openSettleQuietTimer: number | undefined
  let openSettleHardCapTimer: number | undefined
  let openSettleLoadHandler: ((event: Event) => void) | undefined

  // Whether the scroll position is at (or within a hair of) the newest message.
  // Drives two things: marking everything read once the user reaches the bottom
  // (via onAtBottom), and only auto-following new arrivals when they're already
  // there (so a user reading up at the divider isn't yanked down).
  const isAtBottom = ref(true)
  function updateAtBottom() {
    const el = scrollContainer.value
    if (!el) {
      isAtBottom.value = true
      return
    }
    isAtBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }
  function onScroll() {
    updateAtBottom()
    if (isAtBottom.value) options.onAtBottom?.()
  }

  function stopOpenSettle() {
    openSettleObserver?.disconnect()
    openSettleObserver = undefined
    if (openSettleLoadHandler && scrollContainer.value) {
      scrollContainer.value.removeEventListener('load', openSettleLoadHandler, true)
    }
    openSettleLoadHandler = undefined
    if (openSettleQuietTimer !== undefined) {
      window.clearTimeout(openSettleQuietTimer)
      openSettleQuietTimer = undefined
    }
    if (openSettleHardCapTimer !== undefined) {
      window.clearTimeout(openSettleHardCapTimer)
      openSettleHardCapTimer = undefined
    }
  }

  // On open, land the user where they left off: scroll the first unread row just
  // below the top edge if there is one, otherwise jump to the bottom as before.
  function positionOnOpen() {
    nextTick(() => {
      const el = scrollContainer.value
      if (!el) return

      const applyTarget = () => {
        const target = el.querySelector<HTMLElement>('[data-first-unread]')
        // offsetTop (vs getBoundingClientRect) is layout-based, so it stays correct
        // even while the dialog's enter transition is mid-scale. The scroll
        // container is `relative`, so this is the divider's offset within it.
        el.scrollTop = target
          ? Math.max(0, target.offsetTop - 12)
          : Math.max(0, el.scrollHeight - el.clientHeight)
        // Run the same at-bottom check a real scroll would: when the whole log fits
        // in view (e.g. a single message) there's no scroll event to fire it, so the
        // unread badge would otherwise never clear.
        onScroll()
      }

      applyTarget()

      // `nextTick` only waits for Vue's DOM patch, not for portraits, enriched HTML
      // or fonts to lay out — so the first open can scroll before scrollHeight is
      // final and land mid-log. Re-pin to the target as the content height settles,
      // observing the inner content (the scroll container's own box doesn't change
      // when its scrollable content grows). Stop once the height is quiet for a beat,
      // or after a hard cap so slow-streaming images can't pin the view forever.
      stopOpenSettle()
      const content = el.firstElementChild
      if (!content) return

      // Re-pin and (re)start the quiet countdown on a settle event. The countdown
      // is only armed by *real* size changes — the ResizeObserver's first callback
      // is just it reporting the current size, and arming on that would tear us down
      // ~250ms later, before slow-loading portraits/images grow the log on a cold
      // cache and leave the first open stranded above the bottom.
      let sawInitialObservation = false
      const onSettle = (isInitial: boolean) => {
        applyTarget()
        if (isInitial) return
        if (openSettleQuietTimer !== undefined) window.clearTimeout(openSettleQuietTimer)
        openSettleQuietTimer = window.setTimeout(stopOpenSettle, 250)
      }
      openSettleObserver = new ResizeObserver(() => {
        onSettle(!sawInitialObservation)
        sawInitialObservation = true
      })
      openSettleObserver.observe(content)
      // Images are the main late-layout culprit and can finish loading with gaps
      // longer than the quiet window. A direct `load` signal (capture — load events
      // don't bubble) re-pins reliably regardless of how the resizes are spaced.
      openSettleLoadHandler = () => onSettle(false)
      el.addEventListener('load', openSettleLoadHandler, true)
      openSettleHardCapTimer = window.setTimeout(stopOpenSettle, 2000)
    })
  }

  function scrollToBottom(smooth = false) {
    nextTick(() => {
      const el = scrollContainer.value
      if (!el) return

      if (scrollAnimationFrame !== undefined) {
        window.cancelAnimationFrame(scrollAnimationFrame)
        scrollAnimationFrame = undefined
      }

      const target = () => Math.max(0, el.scrollHeight - el.clientHeight)
      if (!smooth) {
        el.scrollTop = target()
        return
      }

      const start = el.scrollTop
      const duration = 180
      const startedAt = performance.now()
      const animate = (now: number) => {
        const progress = Math.min((now - startedAt) / duration, 1)
        const eased = 1 - Math.pow(1 - progress, 3)
        el.scrollTop = start + (target() - start) * eased
        if (progress < 1) {
          scrollAnimationFrame = window.requestAnimationFrame(animate)
        } else {
          scrollAnimationFrame = undefined
        }
      }

      scrollAnimationFrame = window.requestAnimationFrame(animate)
    })
  }

  onBeforeUnmount(() => {
    if (scrollAnimationFrame !== undefined) window.cancelAnimationFrame(scrollAnimationFrame)
    stopOpenSettle()
  })

  return { scrollContainer, isAtBottom, onScroll, positionOnOpen, stopOpenSettle, scrollToBottom }
}
