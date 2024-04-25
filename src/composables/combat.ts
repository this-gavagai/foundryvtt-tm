import type { Ref } from 'vue'
import type { World, Scene, Combat } from '@/types/pf2e-types'
import { ref, watchEffect } from 'vue'

const activeScene = ref()
const activeCombat = ref()

export function useCombat(world: Ref<World> | null = null) {
  if (world) {
    watchEffect(() => {
      activeScene.value = world.value?.scenes?.find((s: Scene) => s.active)
      activeCombat.value = world.value?.combats.find(
        (c: Combat) => c.active && c.scene === activeScene.value._id
      )
    })
  }
  return { activeScene, activeCombat }
}
