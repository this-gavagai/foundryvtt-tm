import { shallowRef, type Ref } from 'vue'
import { defineStore } from 'pinia'
import { debounce } from 'lodash-es'
import type { GamePF2e } from '@7h3laughingman/pf2e-types'
import { useServerStore } from '@/stores/server'

export const useWorldStore = defineStore('world', () => {
  const world = shallowRef<GamePF2e | undefined>(undefined)
  const { getSocket } = useServerStore()

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
  const refreshWorld = () => debouncedWorldRequest()

  return { world, refreshWorld }
})
