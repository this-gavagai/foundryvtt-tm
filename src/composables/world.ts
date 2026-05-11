import { ref, type Ref } from 'vue'
import type { GamePF2e } from '@7h3laughingman/pf2e-types'
import { useServer } from '@/composables/server'
import { debounce } from 'lodash-es'

const world = ref<GamePF2e | undefined>(undefined)

const { getSocket } = useServer()

async function sendWorldRequest(): Promise<Ref<GamePF2e>> {
  const socket = await getSocket()
  return new Promise<Ref<GamePF2e>>((resolve) => {
    socket.emit('world', (r: GamePF2e) => {
      world.value = r
      resolve(world as Ref<GamePF2e>)
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
