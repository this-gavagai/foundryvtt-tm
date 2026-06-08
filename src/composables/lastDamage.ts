import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useWorldStore } from '@/stores/world'

export function useLastDamage() {
  const { world } = storeToRefs(useWorldStore())

  const lastDamageMessage = computed(() => {
    return world.value?.messages?.contents?.slice(-1)[0] as
      | { _id?: string; rolls?: string[] }
      | undefined
  })

  const lastDamageAmount = computed(() => {
    const lastRoll = lastDamageMessage.value?.rolls?.[0]
    if (lastRoll && JSON.parse(lastRoll)?.class === 'DamageRoll') {
      return JSON.parse(lastRoll)?.total
    }
    return 0
  })

  const lastDamageMessageId = computed(() => lastDamageAmount.value > 0
    ? (lastDamageMessage.value?._id ?? undefined)
    : undefined
  )

  return { lastDamageAmount, lastDamageMessageId }
}
