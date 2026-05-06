import { computed } from 'vue'
import { useWorld } from './world'

const { world } = useWorld()

const lastDamageAmount = computed(() => {
  const lastMessage = (world.value?.messages as unknown as { rolls?: string[] }[] | undefined)?.slice(-1)?.[0]

  const lastRoll = lastMessage?.rolls?.[0]
  if (lastRoll && JSON.parse(lastRoll)?.class === 'DamageRoll') {
    console.log(JSON.parse(lastRoll))
    return JSON.parse(lastRoll)?.total
  } else {
    return 0
  }
})

export function useLastDamage() {
  return { lastDamageAmount }
}
