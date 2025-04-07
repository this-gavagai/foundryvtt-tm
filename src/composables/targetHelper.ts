import { ref } from 'vue'
import { computed } from 'vue'
import { useWorld } from './world'
import { useUserId } from '@/composables/user'
import { useApi } from '@/composables/api'
import type { User } from '@/types/foundry-types'
import { useStorage } from '@vueuse/core'

const { world } = useWorld()
const { getUserId, userId } = useUserId()
const { updateUserTargetingProxy } = useApi()
const localProxyId = useStorage('proxy-id', '')

const targets = ref<string[]>([])
const userList = computed(() => {
  return world.value?.users.map((u: User) => ({ id: u._id, name: u.name })) ?? []
})
const targetingProxyId = computed(
  // TODO: fall back on some kind of cached value to make this faster. local store of some sort?
  () =>
    world.value?.users.find((u) => u._id === userId.value)?.flags?.tablemate?.targeting_proxy ??
    localProxyId.value
)

function updateProxyId(newId: string) {
  console.log('newID incoming', newId)
  if (!world.value) return Promise.resolve(null)
  world.value.users.find((u) => u._id === getUserId()).flags.tablemate.targeting_proxy = newId
  const response = updateUserTargetingProxy(getUserId(), newId)
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
