import type { Ref } from 'vue'
import type { World } from '@/types/pf2e-types'
import { computed } from 'vue'
import { useWorld } from './world'

// TODO: make this work using world rather than direct environment access, to facilitate remote use
// possibly set up some type of socket communication to communicate targeting changes?

const { world } = useWorld()

const userList = computed(() => {
  if (!parent.game) return []
  return parent.game.users.map((u: any) => ({ id: u._id, name: u.name })) ?? []
  //return [{ id: 0, name: 'nobody' }]
})

let targetingProxyId = parent?.game?.user?.getFlag('tablemate', 'targeting_proxy')

function getTargetingProxyId() {
  return parent?.game.user.getFlag('tablemate', 'targeting_proxy')
}
function updateProxyId(newId: string) {
  parent?.game.user.setFlag('tablemate', 'targeting_proxy', newId)
  targetingProxyId = newId
}

function getTargets() {
  if (!parent.game) return []
  const targetIds = parent.game.users.find((u: any) => u._id === targetingProxyId.value)?.targets
    ?.ids
  console.log('tablemate current target', targetIds)
  return targetIds
}

export function useTargetHelper(world: Ref<World | undefined> | null = null) {
  return {
    getTargets,
    userList,
    targetingProxyId,
    getTargetingProxyId,
    updateProxyId
  }
}
