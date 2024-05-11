import type { Ref } from 'vue'
import type { World, Scene, Combat, EventArgs } from '@/types/pf2e-types'
import { ref, watchEffect, computed, inject } from 'vue'
import { useKeys } from '@/composables/injectKeys'
import { useServer } from '@/composables/server'

const world = inject(useKeys().worldKey)!
let targets = ref<string[]>([])

const { getSocket } = useServer()
getSocket().then((socket) => {
  socket.on('module.tablemate', (args: EventArgs) => {
    if (args.action === 'shareTarget') {
      console.log('target changed!', args)
      targets.value = args.targets
    }
  })
})

// const targets = ref()

// parent.Hooks.on('targetToken', (user: any, token: any, targeted: boolean) => {
//   console.log('tablemate: token change', user, token, targeted)
// })

// const targets = computed(() => {
//   if (!parent.game) return []
//   // const targetIds = parent.game.users.find((u: any) => u._id === 'USTjxwcLFhdONHph').targets.ids
//   const targetIds = parent.game.users
//     .find((u: any) => u._id === 'USTjxwcLFhdONHph')
//     .getFlag('tablemate', 'targets')
//   console.log('current target', targetIds)
//   return targetIds
// })

export function useTargetHelper(world: Ref<World | undefined> | null = null) {
  return { targets }
}
