import { ref, watchEffect } from 'vue'
import { useWorld } from './world'

const { world } = useWorld()

const activeScene = ref()
const activeCombat = ref()

export function useCombat() {
  if (world) {
    watchEffect(() => {
      activeScene.value = world.value?.scenes?.find((s) => s.active)
      activeCombat.value = world.value?.combats.find(
        (c) => c.active //&& c.scene === activeScene.value._id
      )
    })
  }
  return { activeScene, activeCombat }
}
