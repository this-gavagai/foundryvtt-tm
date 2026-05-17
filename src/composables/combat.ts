import { ref, watchEffect } from 'vue'
import { storeToRefs } from 'pinia'
import { useWorldStore } from '@/stores/world'

const activeScene = ref()
const activeCombat = ref()

export function useCombat() {
  const { world } = storeToRefs(useWorldStore())
  watchEffect(() => {
    activeScene.value = world.value?.scenes?.find((s) => s.active)
    activeCombat.value = world.value?.combats.find(
      (c) => c.active //&& c.scene === activeScene.value._id
    )
  })
  return { activeScene, activeCombat }
}
