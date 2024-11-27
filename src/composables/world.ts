import { ref } from 'vue'
import type { World } from '@/types/pf2e-types'
import { useServer } from '@/composables/server'
import { debounce } from 'lodash-es'

const world = ref<World | null>(null)

const { getSocket } = useServer()

async function sendWorldRequest() {
  const socket = await getSocket()
  console.log()
  socket.emit('world', (r: World) => (world.value = r))
}

const debouncedWorldRequest = debounce(sendWorldRequest, 2000, { leading: true })
const refreshWorld = () => {
  console.log('TABLEMATE: requesting world!')
  return debouncedWorldRequest()
}

export function useWorld() {
  return { world, refreshWorld }
}
