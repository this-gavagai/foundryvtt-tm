import { computed, ref } from 'vue'

const stack = ref<number[]>([])
let nextId = 1
let nextZIndex = 60

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
  }

  function closeLayer() {
    stack.value = stack.value.filter((layerId) => layerId !== id)
    if (stack.value.length === 0) nextZIndex = base
  }

  return { zIndex, openLayer, closeLayer }
}
