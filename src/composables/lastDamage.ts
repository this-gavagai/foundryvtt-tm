import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useWorldStore } from '@/stores/world'

export function useLastDamage() {
  const { world } = storeToRefs(useWorldStore())
  const lastDamageAmount = computed(() => {
    const lastMessage = world.value?.messages?.contents.slice(-1)[0] as
      | { rolls?: string[] }
      | undefined

    const lastRoll = lastMessage?.rolls?.[0]
    if (lastRoll && JSON.parse(lastRoll)?.class === 'DamageRoll') {
      return JSON.parse(lastRoll)?.total
    } else {
      return 0
    }
  })
  return { lastDamageAmount }
}
