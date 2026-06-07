import type { Ref } from 'vue'
import { triggerRef } from 'vue'
import { mergeWith } from 'lodash-es'
import type DocumentSocketResponse from '@7h3laughingman/foundry-types/common/abstract/socket.mjs'
import type { GamePF2e } from '@7h3laughingman/pf2e-types'
import type { TablemateCharacter } from '@/types/character-types'
import type { ModuleEventArgs } from '@/types/api-types'
import { useTargetHelperStore } from '@/stores/targetHelper'
import { useListenersStore } from '@/stores/listenersOnline'
import { logger } from '@/utils/utilities'
import {
  getSocket,
  mergeWithArrayReset,
  asDocumentArray,
  type ModifyDocumentUpdate
} from './internal'
import { addRefresh, fireRefresh, parseActorData } from './characterSync'
import { processChanges } from './documents'
import { resolveAck } from './actions'
import { TM } from './protocol'

// ── TM.CHANNEL dispatcher ────────────────────────────────────────────────
// One socket listener owns TM.CHANNEL; everyone else registers handlers via
// onTmAction(action, handler). Multiple handlers can subscribe to the same
// action — they all fire in registration order. Returned cleanup removes
// the subscription without touching the socket.

type TmHandler<K extends ModuleEventArgs['action']> = (
  args: Extract<ModuleEventArgs, { action: K }>
) => void
type AnyTmHandler = (args: ModuleEventArgs) => void

// Handlers are stored under a widened type because a mapped object type can't
// accept assignment when the key is a generic. The dispatcher always invokes
// each handler with args matching its registered action, so the cast at the
// insertion boundary is sound at runtime.
const tmSubs = new Map<string, Set<AnyTmHandler>>()

export function onTmAction<K extends ModuleEventArgs['action']>(
  action: K,
  handler: TmHandler<K>
): () => void {
  let set = tmSubs.get(action)
  if (!set) {
    set = new Set()
    tmSubs.set(action, set)
  }
  const h = handler as AnyTmHandler
  set.add(h)
  return () => {
    set!.delete(h)
  }
}

type AppChannelHandler = (args: ModuleEventArgs) => void
type ModifyDocumentHandler = (args: DocumentSocketResponse) => void
type UserActivityHandler = (user: string, args: { targets?: string[]; active?: boolean }) => void

let dispatchHandler: AppChannelHandler | null = null
let worldModifyHandler: ModifyDocumentHandler | null = null
let worldUserActivityHandler: UserActivityHandler | null = null
let appSubsRegistered = false

export async function setupSocketListenersForApp() {
  const socket = await getSocket()

  // Re-attach the dispatcher to the (potentially new) socket. The subscription
  // registry is module-level and survives socket swaps.
  if (dispatchHandler) socket.off(TM.CHANNEL, dispatchHandler)
  dispatchHandler = (args: ModuleEventArgs) => {
    tmSubs.get(args.action)?.forEach((h) => h(args))
  }
  socket.on(TM.CHANNEL, dispatchHandler)

  // Register the app-level subscribers exactly once. Subsequent calls to
  // setupSocketListenersForApp only re-attach the dispatcher.
  if (appSubsRegistered) return
  appSubsRegistered = true

  const { addListener } = useListenersStore()
  onTmAction(TM.ACK, (args) => resolveAck(args.uuid, args))
  onTmAction(TM.SHARE_TARGETS, (args) => {
    const { updateTargets } = useTargetHelperStore()
    Object.entries(args.targets).forEach(([userId, targets]) =>
      updateTargets(userId, targets as string[])
    )
  })
  onTmAction(TM.LISTENER_ONLINE, (args) => addListener(args.userId))
}

export async function setupSocketListenersForWorld(world: Ref<GamePF2e>) {
  const socket = await getSocket()

  if (worldModifyHandler) socket.off('modifyDocument', worldModifyHandler)
  worldModifyHandler = (args: DocumentSocketResponse) => {
    switch (args.type) {
      case 'Combat':
        processChanges(args, asDocumentArray(world.value?.combats))
        triggerRef(world)
        break
      case 'Combatant': {
        const combatId = args.operation.parentUuid?.split('.')?.[1]
        const combat = world.value?.combats.find((c) => c._id === combatId)
        processChanges(args, asDocumentArray(combat?.combatants))
        triggerRef(world)
        break
      }
      case 'ChatMessage':
        processChanges(args, asDocumentArray(world.value?.messages))
        triggerRef(world)
        break
    }
  }
  socket.on('modifyDocument', worldModifyHandler)

  if (worldUserActivityHandler) socket.off('userActivity', worldUserActivityHandler)
  worldUserActivityHandler = (user: string, args: { targets?: string[]; active?: boolean }) => {
    if (args.targets) {
      logger.info('user event', user, args)
      const { updateTargets } = useTargetHelperStore()
      updateTargets(user, args.targets)
    } else if (args.active) {
      logger.info('user online', user, args)
    }
  }
  socket.on('userActivity', worldUserActivityHandler)
}

export async function setupSocketListenersForActor(
  actorId: string,
  actor: Ref<TablemateCharacter | undefined>,
  refreshMethod: () => Promise<void>
): Promise<() => void> {
  const socket = await getSocket()
  const removeRefresh = addRefresh(actorId, refreshMethod)

  const unsubListener = onTmAction(TM.LISTENER_ONLINE, () => {
    if (!actor.value?.inventory) fireRefresh(actorId)
  })
  const unsubUpdate = onTmAction(TM.UPDATE_CHARACTER, (args) => {
    parseActorData(actorId, actor, args)
  })

  const modifyHandler = (args: DocumentSocketResponse) => {
    if (!actor.value) return
    switch (args.type) {
      case 'Actor':
        ;(args.result as ModifyDocumentUpdate[]).forEach((result: ModifyDocumentUpdate) => {
          if (result._id === actorId) {
            mergeWith(actor.value, result, mergeWithArrayReset)
            fireRefresh(actorId)
          }
        })
        break
      case 'Item':
        if (args.operation.parentUuid === 'Actor.' + actorId) {
          processChanges(args, asDocumentArray(actor.value.items))
          fireRefresh(actorId)
        }
        break
    }
  }
  socket.on('modifyDocument', modifyHandler)

  return () => {
    unsubListener()
    unsubUpdate()
    socket.off('modifyDocument', modifyHandler)
    removeRefresh()
  }
}
