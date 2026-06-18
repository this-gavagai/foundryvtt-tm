import type { Ref } from 'vue'
import { triggerRef } from 'vue'
import { mergeWith } from 'lodash-es'
import type { Socket } from 'socket.io-client'
import type DocumentSocketResponse from '@7h3laughingman/foundry-types/common/abstract/socket.mjs'
import type { GamePF2e } from '@7h3laughingman/pf2e-types'
import type { TablemateActor } from '@/types/character-types'
import type { ModuleEventArgs } from '@/types/api-types'
import { useTargetHelperStore } from '@/stores/targetHelper'
import { useListenersStore } from '@/stores/listenersOnline'
import { useSyncStatusStore } from '@/stores/syncStatus'
import { logger } from '@/utils/utilities'
import {
  getSocket,
  mergeWithArrayReset,
  asDocumentArray,
  type ModifyDocumentUpdate,
  type DocumentData
} from './internal'
import { addRefresh, fireRefresh, parseActorData } from './characterSync'
import { processChanges } from './documents'
import { resolveAck } from './actionRpc'
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
let dispatchSocket: Socket | null = null
let worldModifyHandler: ModifyDocumentHandler | null = null
let worldModifySocket: Socket | null = null
let worldUserActivityHandler: UserActivityHandler | null = null
let worldUserActivitySocket: Socket | null = null
let appSubsRegistered = false

export async function setupSocketListenersForApp() {
  const socket = await getSocket()

  // Re-attach the dispatcher to the (potentially new) socket. The subscription
  // registry is module-level and survives socket swaps.
  if (dispatchHandler) dispatchSocket?.off(TM.CHANNEL, dispatchHandler)
  dispatchHandler = (args: ModuleEventArgs) => {
    tmSubs.get(args.action)?.forEach((h) => h(args))
  }
  socket.on(TM.CHANNEL, dispatchHandler)
  dispatchSocket = socket

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

export async function setupSocketListenersForWorld(world: Ref<GamePF2e | undefined>) {
  const socket = await getSocket()

  if (worldModifyHandler) worldModifySocket?.off('modifyDocument', worldModifyHandler)
  worldModifyHandler = (args: DocumentSocketResponse) => {
    switch (args.type) {
      case 'Combat':
        processChanges(args, asDocumentArray(world.value?.combats))
        triggerRef(world)
        break
      case 'Combatant': {
        const combatId = args.operation.parentUuid?.split('.')?.[1]
        const combats = asDocumentArray(world.value?.combats)
        const idx = combats?.findIndex((c) => c._id === combatId) ?? -1
        if (combats && idx !== -1) {
          const combat = combats[idx] as DocumentData & { combatants?: unknown }
          processChanges(args, asDocumentArray(combat.combatants))
          // Replace the combat with a fresh reference. We mutate combatants in
          // place, so `activeCombat = combats.find(c => c.active)` would otherwise
          // recompute to the same object — and Vue 3.4+ computeds short-circuit
          // when their value is Object.is-equal, leaving dependents (e.g. the
          // initiative roll button) stale until a full world refresh.
          combats[idx] = { ...combat }
        }
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
  worldModifySocket = socket

  if (worldUserActivityHandler)
    worldUserActivitySocket?.off('userActivity', worldUserActivityHandler)
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
  worldUserActivitySocket = socket
}

export async function setupSocketListenersForActor(
  actorId: string,
  actor: Ref<TablemateActor | undefined>,
  refreshMethod: () => Promise<void>
): Promise<() => void> {
  const socket = await getSocket()
  const removeRefresh = addRefresh(actorId, refreshMethod)

  // When a GM announces presence, re-fetch any actor still waiting on live
  // data. We re-fetch if inventory is missing (never loaded) OR the actor is
  // flagged stale — a cached snapshot from a prior session already carries
  // inventory, so gating on inventory alone would leave a stale sheet spinning
  // forever when its initial request was dropped because no GM was listening.
  const syncStatus = useSyncStatusStore()
  const unsubListener = onTmAction(TM.LISTENER_ONLINE, () => {
    if (!actor.value?.inventory || syncStatus.staleActors.has(actorId)) fireRefresh(actorId)
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
