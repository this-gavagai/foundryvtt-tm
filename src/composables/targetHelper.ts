import type { Ref } from 'vue'
import { ref } from 'vue'
import type { World } from '@/types/pf2e-types'
import { computed } from 'vue'
import { useWorld } from './world'
import { useUserId } from '@/composables/user'
import { useApi } from '@/composables/api'

// TODO: targets only update on change. need a way to request targets on load/proxy-change

const { world } = useWorld()
const { getUserId, userId } = useUserId()
const { updateUserTargetingProxy } = useApi()

const targets = ref<string[]>([])
const userList = computed(() => {
  return world.value?.users.map((u: any) => ({ id: u._id, name: u.name })) ?? []
})
const targetingProxyId = computed(() => {
  const proxy = world.value?.users.find((u) => u._id === userId.value)?.flags?.tablemate
    ?.targeting_proxy
  console.log('targeting!', userId.value, proxy)
  return proxy
})

function getTargetingProxyId() {
  const proxy = world.value?.users.find((u) => u._id === getUserId())?.flags?.tablemate
    ?.targeting_proxy
  console.log('PROXY: ', proxy, getUserId())
  return proxy
}
function updateProxyId(newId: string) {
  if (!world.value) return
  world.value.users.find((u) => u._id === getUserId()).flags.tablemate.targeting_proxy = newId
  updateUserTargetingProxy(getUserId(), newId)
}

function updateTargets(user: string, newTargets: string[]) {
  if (user === getTargetingProxyId()) {
    console.log('TABLEMATE new targets', newTargets)
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
    getTargetingProxyId,
    updateProxyId,
    updateTargets
  }
}
