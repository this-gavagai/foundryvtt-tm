import { ref, watchEffect } from 'vue'

const activeScene = ref<any>()
const activeCombat = ref<any>()

export function useCombat(world: any = null) {
  if (world) {
    watchEffect(() => {
      activeScene.value = world.value?.scenes?.find((s: any) => s.active)
      activeCombat.value = world.value?.combats.find(
        (c: any) => c.active && c.scene === activeScene.value._id
      )
    })
  }
  return { activeScene, activeCombat }
}
