import { computed, ref } from 'vue'

const stack = ref<number[]>([])
let nextId = 1
let nextZIndex = 60
// z-index of the topmost currently-open overlay (0 when none are open).
const topZIndex = ref(0)

export function useOverlayStack(base = 60, step = 10) {
  const id = nextId++
  const lastZIndex = ref(base)

  const zIndex = computed(() => lastZIndex.value)

  function openLayer() {
    if (stack.value.includes(id)) return
    if (stack.value.length === 0) nextZIndex = base
    lastZIndex.value = nextZIndex
    nextZIndex += step
    stack.value.push(id)
    topZIndex.value = lastZIndex.value
  }

  function closeLayer() {
    stack.value = stack.value.filter((layerId) => layerId !== id)
    if (stack.value.length === 0) nextZIndex = base
    topZIndex.value = stack.value.length === 0 ? 0 : nextZIndex - step
  }

  return { zIndex, openLayer, closeLayer }
}

// Reactive z-index of the topmost open overlay. Teleported popovers (e.g.
// dropdown options) that need to render above whatever modal contains them
// can offset from this. 0 when no overlay is open.
export function useTopOverlayZIndex() {
  return computed(() => topZIndex.value)
}
