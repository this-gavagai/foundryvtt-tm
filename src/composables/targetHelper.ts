import { ref } from 'vue'
import { computed } from 'vue'
import { useWorld } from './world'
import { useUserId } from '@/composables/user'
import { useApi } from '@/composables/api'
import type { UserPF2e } from '@7h3laughingman/pf2e-types'
import type DocumentSocketResponse from '@7h3laughingman/foundry-types/common/abstract/socket.mjs'
import { useStorage } from '@vueuse/core'

const { world } = useWorld()
const { getUserId, userId } = useUserId()
const { updateUserTargetingProxy } = useApi()
const localProxyId = useStorage('proxy-id', '')

const targets = ref<string[]>([])
const userList = computed(() => {
  return world.value?.users.map((u: UserPF2e) => ({ id: u._id ?? undefined, name: u.name })) ?? []
})
const targetingProxyId = computed(
  () =>
    (world.value?.users.find((u) => u._id === userId.value)?.flags?.tablemate
      ?.targeting_proxy as string | undefined) ?? localProxyId.value
)

function updateProxyId(newId: string): Promise<DocumentSocketResponse | null> {
  console.log('newID incoming', newId)
  if (!world.value) return Promise.resolve(null)

  // update remote
  const response = updateUserTargetingProxy(getUserId(), newId)
  // update local
  const flagsBase = (world.value.users.find((u) => u._id === getUserId())?.flags?.tablemate ?? {}) as Record<string, unknown>
  flagsBase.targeting_proxy = newId

  localProxyId.value = newId
  return response
}

function updateTargets(user: string, newTargets: string[]) {
  if (user === targetingProxyId.value) {
    targets.value = newTargets
  }
}

function getTargets() {
  return targets.value
}

export function useTargetHelper() {
  return {
    getTargets,
    userList,
    targetingProxyId,
    updateProxyId,
    updateTargets
  }
}
