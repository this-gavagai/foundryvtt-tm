import { ref, type Ref, type VNodeRef, watchPostEffect } from 'vue'
import type { Actor, World } from '@/types/pf2e-types'
import { useApi } from '@/composables/api'
import { useServer } from '@/composables/server'
import { useThrottleFn, useDebounceFn } from '@vueuse/core'

const world = ref<World | null>(null)

const { getSocket } = useServer()

async function sendWorldRequest() {
  const socket = await getSocket()
  socket.emit('world', (r: World) => (world.value = r))
}
const refreshWorld = useDebounceFn(sendWorldRequest, 1000)

export function useWorld() {
  return { world, refreshWorld }
}
