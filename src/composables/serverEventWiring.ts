import type { Ref } from 'vue'
import { triggerRef } from 'vue'
import { mergeWith } from 'lodash-es'
import type DocumentSocketResponse from '@7h3laughingman/foundry-types/common/abstract/socket.mjs'
import type { GamePF2e } from '@7h3laughingman/pf2e-types'
import type { TablemateActor } from '@/types/character-types'
import { useServerStore } from '@/stores/server'
import { useTargetHelperStore } from '@/stores/targetHelper'
import { useListenersStore } from '@/stores/listenersOnline'
import { useVersionCompatStore } from '@/stores/versionCompat'
import { useGmPolicyStore } from '@/stores/gmPolicy'
import { useSyncStatusStore } from '@/stores/syncStatus'
import { useFoundryWorldStatusStore } from '@/stores/foundryWorldStatus'
import { useWorldStore } from '@/stores/world'
import { logger } from '@/utils/utilities'
import {
  onModifyDocument,
  onSocketSwap,
  onTmAction,
  onUserActivity,
  onWorldProgress
} from '@/api/socketSetup'
import {
  mergeWithArrayReset,
  asDocumentArray,
  type ModifyDocumentUpdate,
  type DocumentData
} from '@/api/internal'
import { addRefresh, fireAllRefresh, fireRefresh, parseActorData } from '@/api/characterSync'
import { processChanges } from '@/api/documents'
import { TM } from '@/api/protocol'

// The store-facing half of the socket wiring: subscribes to the api layer's
// event registries (api/socketSetup.ts) and drives Pinia stores in response.
// Living here — not in api/ — keeps the api layer facing strictly downward.
//
// Registration is once-per-app and socket-agnostic: the registries survive
// socket swaps, so nothing here needs re-running when the socket is replaced.

// Foundry streams 'progress' events while a world loads. We mark the world
// pending immediately, then refresh once events stop arriving (trailing edge).
const WORLD_PROGRESS_DEBOUNCE_MS = 2000

let progressTimer: ReturnType<typeof setTimeout> | undefined
let appWiringRegistered = false

// Called by useSession before the first connectToServer, so every handler —
// including the session hooks below — is live before any socket can emit.
export function registerServerEventWiring() {
  if (appWiringRegistered) return
  appWiringRegistered = true

  // Session lifecycle → world orchestration. Inverted through hooks so the
  // server store carries no knowledge of the world store or character sync
  // (previously a server ⇄ world import cycle).
  useServerStore().registerSessionHooks({
    // A different user id means we've switched servers (or re-logged as
    // someone else). The last-known world belongs to the previous user, so
    // drop it before sessionReady flips — otherwise a sheet would briefly
    // check the new user against the old actor's ownership and flash
    // "userDoesNotOwnCharacter" until the fresh world arrives. A same-user
    // reconnect keeps the stale world for a seamless resume.
    onUserChanged: () => useWorldStore().clearWorld(),
    // Re-fire downstream refreshes on every session handshake. This covers
    // both initial auth and post-reconnect re-auth — including socket.io's
    // internal soft reconnects, which don't replace the socket ref and
    // therefore don't trip useSession's socket-watch.
    onSessionAuthenticated: () => {
      void useWorldStore().refreshWorldNow()
      fireAllRefresh()
    }
  })

  onTmAction(TM.SHARE_TARGETS, (args) => {
    const { updateTargets } = useTargetHelperStore()
    Object.entries(args.targets).forEach(([userId, targets]) =>
      updateTargets(userId, targets as string[])
    )
  })

  onTmAction(TM.LISTENER_ONLINE, (args) => {
    useListenersStore().addListener(args.userId)
    // The module reports its protocol/version on every announcement; compare so
    // the app can surface a banner when a stale PWA meets a newer module (or
    // vice versa). A module too old to send `protocol` reads as undefined here,
    // which is correctly treated as a mismatch.
    useVersionCompatStore().reportModule(args.protocol, args.moduleVersion)
    // World manual-roll policy rides along on every announcement (including
    // the re-announce the module fires when the GM changes the setting).
    useGmPolicyStore().reportPolicy(args.manualRollPolicy)
  })

  onWorldProgress(() => {
    useFoundryWorldStatusStore().markWorldPending()
    clearTimeout(progressTimer)
    progressTimer = setTimeout(() => useWorldStore().refreshWorld(), WORLD_PROGRESS_DEBOUNCE_MS)
  })

  // Drop any trailing-refresh armed against the old socket: on a hard swap
  // the world context is changing, so a pending refresh for the prior load
  // is stale.
  onSocketSwap(() => clearTimeout(progressTimer))
}

let worldModifyUnsub: (() => void) | null = null
let worldUserActivityUnsub: (() => void) | null = null

// World-scoped handlers, registered once a world exists. Re-calling replaces
// the previous registration (same handler-slot semantics as before the
// registry refactor); no socket access is needed because the registries are
// socket-agnostic.
export function setupSocketListenersForWorld(world: Ref<GamePF2e | undefined>) {
  worldModifyUnsub?.()
  worldModifyUnsub = onModifyDocument((args: DocumentSocketResponse) => {
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
        // Signal the chat cache that messages changed even when the mutation is
        // invisible to its count/tail fingerprint (in-place updates).
        useWorldStore().bumpMessagesRevision()
        triggerRef(world)
        break
    }
  })

  worldUserActivityUnsub?.()
  worldUserActivityUnsub = onUserActivity((user, args) => {
    if (args.targets) {
      logger.info('user event', user, args)
      const { updateTargets } = useTargetHelperStore()
      updateTargets(user, args.targets)
    } else if (args.active) {
      logger.info('user online', user, args)
    }
  })
}

// Registers purely against module-level registries (no socket capture), so
// subscriptions are live immediately and survive socket swaps. Kept async for
// callers that treat setup as a lifecycle step.
export async function setupSocketListenersForActor(
  actorId: string,
  actor: Ref<TablemateActor | undefined>,
  refreshMethod: () => Promise<void>
): Promise<() => void> {
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
  const unsubModify = onModifyDocument(modifyHandler)

  return () => {
    unsubListener()
    unsubUpdate()
    unsubModify()
    removeRefresh()
  }
}
