import { shallowRef } from 'vue'
import type { GamePF2e } from '@7h3laughingman/pf2e-types'
import { useServer } from '@/composables/server'
import { debounce } from 'lodash-es'

const world = shallowRef<GamePF2e | undefined>(undefined)

const { getSocket } = useServer()

async function sendWorldRequest(): Promise<typeof world> {
  const socket = await getSocket()
  return new Promise<typeof world>((resolve) => {
    socket.emit('world', (r: GamePF2e) => {
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
