import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { useServerStore } from '@/stores/server'
import { useUserStore } from '@/stores/user'
import { logger } from '@/utils/utilities'

// TODO: do a sweep to deactivate things that need to be deactivated in the absence of a listener
// Off hand, that includes Initiative skill, Hero Point modifiers, HP stats (crashing now)

export const useListenersStore = defineStore('listenersOnline', () => {
  const listenersOnline = ref(new Map<string, number>())
  const isListening = computed(() => listenersOnline.value.size > 0)

  function addListener(listenerId: string) {
    logger.debug('TM adding listener', listenerId)
    listenersOnline.value.set(listenerId, Date.now())
  }

  function getListeners() {
    return listenersOnline
  }

  // Heartbeat: ping every 30s and prune stale listeners. Scheduled on the
  // first useListenersStore() invocation (store setup runs once).
  setInterval(async () => {
    const socket = await useServerStore().getSocket()
    socket?.emit('module.tablemate', {
      userId: useUserStore().getUserId(),
      action: 'anybodyHome'
    })
    listenersOnline.value.forEach((value, key, map) => {
      if (Date.now() - value > 40000) map.delete(key)
    })
  }, 30000)

  return { listenersOnline, isListening, addListener, getListeners }
})
