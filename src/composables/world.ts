import { ref, type Ref, type VNodeRef, watchPostEffect } from 'vue'
import type { Actor, World } from '@/types/pf2e-types'
import { useApi } from '@/composables/api'
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
