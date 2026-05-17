import { ref, computed } from 'vue'
import { defineStore, storeToRefs } from 'pinia'
import { useStorage } from '@vueuse/core'
import { useWorldStore } from '@/stores/world'
import { useUserStore } from '@/stores/user'
import { updateUserTargetingProxy } from '@/composables/api/documents'
import type { UserPF2e } from '@7h3laughingman/pf2e-types'
import type DocumentSocketResponse from '@7h3laughingman/foundry-types/common/abstract/socket.mjs'
import { logger } from '@/utils/utilities'

export const useTargetHelperStore = defineStore('targetHelper', () => {
  const { world } = storeToRefs(useWorldStore())
  const userStore = useUserStore()
  const { userId } = storeToRefs(userStore)
  const { getUserId } = userStore

  const localProxyId = useStorage('proxy-id', '')
  const targets = ref<string[]>([])

  const userList = computed(
    () =>
      world.value?.users.map((u: UserPF2e) => ({ id: u._id ?? undefined, name: u.name })) ?? []
  )

  const targetingProxyId = computed(
    () =>
      (world.value?.users.find((u) => u._id === userId.value)?.flags?.tablemate?.targeting_proxy as
        | string
        | undefined) ?? localProxyId.value
  )

  function updateProxyId(newId: string): Promise<DocumentSocketResponse | null> {
    logger.debug('TM-info: newID incoming', newId)
    if (!world.value) return Promise.resolve(null)

    // update remote
    const response = updateUserTargetingProxy(getUserId(), newId)
    // update local
    const tablemate = world.value.users.find((u) => u._id === getUserId())?.flags?.tablemate as
      | { targeting_proxy?: string }
      | undefined
    if (tablemate) tablemate.targeting_proxy = newId

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

  return {
    targets,
    getTargets,
    userList,
    targetingProxyId,
    updateProxyId,
    updateTargets
  }
})
