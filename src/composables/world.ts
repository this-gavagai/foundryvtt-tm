import { ref, type Ref } from 'vue'
import type { World } from '@/types/pf2e-types'
import { useServer } from '@/composables/server'
import { debounce } from 'lodash-es'

const world = ref<World | undefined>(undefined)

const { getSocket } = useServer()

async function sendWorldRequest(): Promise<Ref<World | undefined>> {
  const socket = await getSocket()
  return new Promise((resolve) => {
    socket.emit('world', (r: World) => {
      world.value = r
      resolve(world)
    })
  })
}
const debouncedWorldRequest = debounce(sendWorldRequest, 2000, { leading: true })
const refreshWorld = () => {
  return debouncedWorldRequest()
}

export function useWorld() {
  return { world, refreshWorld }
}
