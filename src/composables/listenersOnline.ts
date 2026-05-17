import { ref, computed } from 'vue'
import { useServerStore } from '@/stores/server'
import { useUserStore } from '@/stores/user'
import { logger } from '@/utils/utilities'

// TODO: do a sweep to deactivate things that need to be deactivated in the absence of a listner
// Off hand, that includes Initiative skill, Hero Point modifiers, HP stats (crashing now)

const listenersOnline = ref(new Map<string, number>())
const isListening = computed(() => listenersOnline.value.size > 0)

setInterval(async () => {
  // Stores resolved lazily — Pinia is installed by the time the first 30s
  // tick fires.
  const socket = await useServerStore().getSocket()
  socket?.emit('module.tablemate', {
    userId: useUserStore().getUserId(),
    action: 'anybodyHome'
  })

  listenersOnline.value.forEach((value, key, map) => {
    if (Date.now() - value > 40000) map.delete(key)
  })
}, 30000)

export function useListeners() {
  function addListener(listenerId: string) {
    logger.debug('TM adding listener', listenerId)
    listenersOnline.value.set(listenerId, Date.now())
  }
  function getListeners() {
    return listenersOnline
  }

  return { getListeners, addListener, isListening }
}
