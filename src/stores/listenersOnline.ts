import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { useServerStore } from '@/stores/server'
import { useUserStore } from '@/stores/user'
import { useWorldStore } from '@/stores/world'
import { logger } from '@/utils/utilities'
import { TM } from '@/api/protocol'

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

  async function pingHeartbeat() {
    const socket = await useServerStore().getSocket()
    socket?.emit(TM.CHANNEL, {
      userId: useUserStore().getUserId(),
      action: TM.ANYBODY_HOME
    })
    listenersOnline.value.forEach((value, key, map) => {
      if (Date.now() - value > 15000) map.delete(key)
    })
    useWorldStore().refreshWorld()
  }

  // Heartbeat: ping every 5s. Scheduled on the first useListenersStore()
  // invocation (store setup runs once).
  setInterval(pingHeartbeat, 5000)

  // Mobile browsers throttle or pause setInterval when the tab is in the
  // background, so the heartbeat can lapse — leaving isListening stuck on
  // false (and roll buttons hidden) until the next tick. Re-ping immediately
  // when the page comes back into focus.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pingHeartbeat()
  })

  return { listenersOnline, isListening, addListener, getListeners }
})
