import { ref, computed } from 'vue'
import { useServer } from '@/composables/server'
import { useUserId } from '@/composables/user'

const { getSocket } = useServer()
const { userId } = useUserId()

const listenersOnline = ref(new Map<string, number>())
const isListening = computed(() => listenersOnline.value.size > 0)

setInterval(async () => {
  const socket = await getSocket()
  socket?.emit('module.tablemate', { userId, action: 'anybodyHome' })

  listenersOnline.value.forEach((value, key, map) => {
    if (Date.now() - value > 40000) map.delete(key)
  })
}, 30000)

export function useListeners() {
  function addListener(listenerId: string) {
    console.log('TM adding listener', listenerId)
    listenersOnline.value.set(listenerId, Date.now())
  }
  function getListeners() {
    return listenersOnline
  }

  return { getListeners, addListener, isListening }
}
