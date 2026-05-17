import { computed } from 'vue'
import { defineStore, storeToRefs } from 'pinia'
import { useWorldStore } from '@/stores/world'

export const useCombatStore = defineStore('combat', () => {
  const { world } = storeToRefs(useWorldStore())
  const activeScene = computed(() => world.value?.scenes?.find((s) => s.active))
  const activeCombat = computed(() => world.value?.combats.find((c) => c.active))
  return { activeScene, activeCombat }
})
