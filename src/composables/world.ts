import { ref, type Ref, type VNodeRef, watchPostEffect } from 'vue'
import type { Actor, World } from '@/types/pf2e-types'
import { useApi } from '@/composables/api'
import { useServer } from '@/composables/server'
import { useThrottleFn, useDebounceFn } from '@vueuse/core'

const world = ref<World | null>(null)

const { getSocket } = useServer()

async function sendWorldRequest() {
  const socket = await getSocket()
  console.log()
  socket.emit('world', (r: World) => (world.value = r))
}

const debouncedWorldRequest = useDebounceFn(sendWorldRequest, 2000)
const refreshWorld = () => {
  console.log('requesting world!')
  return debouncedWorldRequest()
}

export function useWorld() {
  return { world, refreshWorld }
}
