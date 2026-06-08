import { ref, computed, onScopeDispose } from 'vue'
import { defineStore } from 'pinia'
import { getAuthenticatedSocket } from '@/api/internal'
import { logger } from '@/utils/utilities'
import { TM } from '@/api/protocol'

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
    const { socket, userId } = await getAuthenticatedSocket()
    socket.emit(TM.CHANNEL, {
      userId,
      action: TM.ANYBODY_HOME
    })
    listenersOnline.value.forEach((value, key, map) => {
      if (Date.now() - value > 45000) map.delete(key)
    })
  }

  function safePingHeartbeat() {
    void pingHeartbeat().catch(() => undefined)
  }

  // Socket heartbeat: ping every 30s to detect listener/GM availability.
  const heartbeatInterval = setInterval(safePingHeartbeat, 30000)
  safePingHeartbeat()

  // Mobile browsers throttle or pause setInterval when the tab is in the
  // background, so the heartbeat can lapse — leaving isListening stuck on
  // false (and roll buttons hidden) until the next tick. Re-ping immediately
  // when the page comes back into focus.
  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') safePingHeartbeat()
  }
  document.addEventListener('visibilitychange', handleVisibilityChange)

  onScopeDispose(() => {
    clearInterval(heartbeatInterval)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  })

  return { listenersOnline, isListening, addListener, getListeners }
})
