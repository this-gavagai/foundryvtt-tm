import { onMounted, onUnmounted } from 'vue'

const canScrollY = (element: Element): element is HTMLElement => {
  if (!(element instanceof HTMLElement)) return false

  const overflowY = window.getComputedStyle(element).overflowY
  if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') return false

  return element.scrollHeight > element.clientHeight
}

const closestScrollable = (event: TouchEvent): HTMLElement | undefined => {
  for (const target of event.composedPath()) {
    if (target === document || target === window) return undefined
    if (target instanceof Element && canScrollY(target)) return target
  }

  return undefined
}

export function useScrollBoundaryLock() {
  let startY = 0
  let startX = 0

  const onTouchStart = (event: TouchEvent) => {
    const touch = event.touches[0]
    if (!touch) return

    startY = touch.clientY
    startX = touch.clientX
  }

  const onTouchMove = (event: TouchEvent) => {
    if (event.touches.length !== 1) return

    const touch = event.touches[0]
    if (!touch) return

    const deltaY = touch.clientY - startY
    const deltaX = touch.clientX - startX

    // Only police vertical scrolling; ignore horizontal-dominant gestures.
    if (Math.abs(deltaX) >= Math.abs(deltaY)) return

    const scroller = closestScrollable(event)
    if (!scroller) {
      event.preventDefault()
      return
    }

    const atTop = scroller.scrollTop <= 0
    const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1
    const pullingDown = deltaY > 0
    const pushingUp = deltaY < 0

    if ((atTop && pullingDown) || (atBottom && pushingUp)) {
      event.preventDefault()
    }
  }

  onMounted(() => {
    document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true })
    document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false })
  })

  onUnmounted(() => {
    document.removeEventListener('touchstart', onTouchStart, { capture: true })
    document.removeEventListener('touchmove', onTouchMove, { capture: true })
  })
}
