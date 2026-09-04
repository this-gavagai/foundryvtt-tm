import type { Ref } from 'vue'
import { triggerRef } from 'vue'
import type DocumentSocketResponse from '@7h3laughingman/foundry-types/common/abstract/socket.mjs'
import type { GamePF2e } from '@7h3laughingman/pf2e-types'
import type { TablemateActor } from '@/types/character-types'
import { useServerStore } from '@/stores/server'
import { useServerAddressStore } from '@/stores/serverAddress'
import { useUserStore } from '@/stores/user'
import { useTargetHelperStore } from '@/stores/targetHelper'
import { useListenersStore } from '@/stores/listenersOnline'
import { useVersionCompatStore } from '@/stores/versionCompat'
import { useGmPolicyStore } from '@/stores/gmPolicy'
import { useTokenRingStore } from '@/stores/tokenRing'
import { useSyncStatusStore } from '@/stores/syncStatus'
import { useFoundryWorldStatusStore } from '@/stores/foundryWorldStatus'
import { useWorldStore } from '@/stores/world'
import { useSettingsStore } from '@/stores/settings'
import { usePixelDiceStore } from '@/stores/pixelDice'
import { resetWorldScopedStores } from '@/stores/worldScopedReset'
import { logger } from '@/utils/utilities'
import {
  onModifyDocument,
  onShareImage,
  onSocketSwap,
  onTmAction,
  onUserActivity,
  onWorldProgress
} from '@/api/socketSetup'
import {
  mergeDocumentChange,
  asDocumentArray,
  type ModifyDocumentUpdate,
  type DocumentData
} from '@/api/internal'
import { collectionToArray, type CollectionLike } from '@/utils/foundryCollections'
import { addRefresh, fireAllRefresh, fireRefresh, parseActorData } from '@/api/characterSync'
import { syncPushRegistration, resetPushSession } from '@/api/pushNotifications'
import { processChanges } from '@/api/documents'
import { resetLoadPriority } from '@/api/loadPriority'
import { registerStoreBridge } from '@/api/storeBridge'
import { TM } from '@/api/protocol'
import { useSharedImage } from '@/composables/useSharedImage'

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
// Inject the store-backed lookups the api layer needs, so api/ imports no Pinia
// store directly (breaking the api ⇄ store import cycles). Called from main.ts
// at bootstrap — before any component mounts — so every RPC/socket call finds
// the bridge in place regardless of component setup order. Registration only
// captures the getter closures; they call use*Store() lazily (during RPCs,
// when Pinia is active) and read store refs live, so reactive reads still track.
export function installApiStoreBridge() {
  registerStoreBridge({
    getSocket: (timeoutMs) => useServerStore().getSocket(timeoutMs),
    getUserId: () => useUserStore().getUserId(),
    sessionReady: () => useServerStore().sessionReady,
    userId: () => useUserStore().userId,
    getTargets: () => useTargetHelperStore().getTargets(),
    resyncTargets: () => useTargetHelperStore().resync(),
    activeServerOrigin: () => useServerAddressStore().serverUrl?.origin,
    getWorldPacks: () =>
      collectionToArray(
        (useWorldStore().world as { packs?: unknown } | undefined)?.packs as CollectionLike<unknown>
      ),
    getUserRole: () => {
      const user = useWorldStore().userById(useUserStore().userId) as { role?: number } | undefined
      return user?.role ?? 0
    },
    getWorldActor: (actorId) => useWorldStore().actorById(actorId)
  })
}

export function registerServerEventWiring() {
  if (appWiringRegistered) return
  appWiringRegistered = true

  // Start the background stores' side effects here — the one place the
  // connected app boots — instead of on each store's first use(). Each start()
  // is idempotent. This is the counterpart to keeping those side effects out of
  // the store setup bodies: merely using a store (in a test, or a new context)
  // no longer fires a network request, an 8s poll, a 30s heartbeat, or a
  // Bluetooth reconnect.
  useWorldStore().start()
  useFoundryWorldStatusStore().start()
  useListenersStore().start()
  usePixelDiceStore().start()
  useTargetHelperStore().start()

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
    onUserChanged: () => {
      useWorldStore().clearWorld()
      resetWorldScopedStores()
      // The push registration belongs to the user we are leaving; drop the
      // "already registered" state so the new one registers itself rather than
      // matching against a stale identity.
      resetPushSession()
    },
    // Re-fire downstream refreshes on every session handshake. This covers
    // both initial auth and post-reconnect re-auth — including socket.io's
    // internal soft reconnects, which don't replace the socket ref and
    // therefore don't trip useSession's socket-watch.
    onSessionAuthenticated: () => {
      void useWorldStore().refreshWorldNow()
      fireAllRefresh()
      // Any gap in the connection is a gap in what the world told us, so
      // everything fed by an unsolicited push has to be re-asked for here.
      //
      // Presence: a recovery-triggered reconnect refreshes world/character data
      // but never re-announces GM presence, leaving the app "connected to the
      // world but without a GM" until the next 30s heartbeat tick.
      useListenersStore().ping()
      // Targets: a gap in the connection is a gap in the proxy's pushes. Re-ask
      // without clearing — the proxy has not changed, so what we hold is
      // possibly stale rather than wrong, and a roll fired before the answer
      // lands should still be aimed. See targetHelper.refresh.
      useTargetHelperStore().refresh()
      // Now authenticated as a known user: (re)register this device's push
      // token with the relay. Fires on reconnects too; the call is idempotent.
      syncPushRegistration()
    }
  })

  // A client reporting its OWN targeting — the single source for mirrored
  // targets. The store drops it unless the sender is this tablet's proxy.
  onTmAction(TM.SHARE_TARGETS, (args) => {
    useTargetHelperStore().updateTargets(args.userId, {
      sceneId: args.sceneId ?? null,
      tokenIds: args.targets ?? []
    })
  })

  onTmAction(TM.LISTENER_ONLINE, (args) => {
    useListenersStore().addListener(args.userId)
    // The module reports its protocol/version on every announcement; compare so
    // the app can surface a banner when a stale PWA meets a newer module (or
    // vice versa). A module too old to send `protocol` reads as undefined here,
    // which is correctly treated as a mismatch.
    useVersionCompatStore().reportModule(args.protocol, args.moduleVersion, args.capabilities)
    // World manual-roll policy rides along on every announcement (including
    // the re-announce the module fires when the GM changes the setting).
    useGmPolicyStore().reportPolicy(args.manualRollPolicy)
    // Which ring art the world uses, for the token rings drawn on avatars.
    useTokenRingStore().reportSpritesheet(args.tokenRing?.spritesheet)
  })

  // Core "show players" image share. Gated on an opt-in setting, and checked
  // here rather than in the modal so a player who left it off never even holds
  // the payload — the popup can't flash on a race with the toggle.
  onShareImage((payload) => {
    if (!useSettingsStore().showSharedImages) return
    useSharedImage().showSharedImage(payload)
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

  // A socket swap starts a fresh cold-load ordering cycle, so an in-app
  // server switch gets the active-character → world → others sequencing
  // instead of gates that already resolved on the previous server.
  onSocketSwap(resetLoadPriority)
}

let worldModifyUnsub: (() => void) | null = null
let worldUserActivityUnsub: (() => void) | null = null

// Give the named encounters a fresh object identity after an in-place mutation.
//
// EVERY encounter mutation needs this, whether it landed on the Combat document
// or on one of its combatants. `processChanges` merges into the existing object,
// so `activeCombat = combats.find(c => c.active)` recomputes to an
// Object.is-equal value — and a Vue 3.4+ computed whose value is unchanged by
// that test does not notify its dependents. The mutation is therefore in the
// data but invisible to anything already rendered from it, until the next full
// world refresh.
//
// It first bit the initiative roll button (a combatant write), which is why the
// Combatant branch had a copy and the Combat branch did not. That asymmetry
// then hid a worse bug: round and turn live on the COMBAT document, so a round
// rollover — Foundry's nextTurn() delegating to nextRound(), one Combat update
// changing both, no combatant touched — left the header's turn bar showing the
// previous round's order. Turn advances within a round appeared to work only
// because PF2e stamps flags.pf2e.roundOfLastTurn on the combatant a moment
// later, and THAT broadcast refreshed the reference. Relying on another
// package's bookkeeping to notice our own state changed is not a mechanism.
//
// Hence one helper, called by both branches, rather than a copy per case.
function refreshCombatRefs(combats: DocumentData[] | undefined, combatIds: string[]) {
  if (!combats) return
  for (const id of combatIds) {
    const idx = combats.findIndex((c) => c._id === id)
    if (idx !== -1) combats[idx] = { ...combats[idx] }
  }
}

// The ids an update broadcast names. Creates and deletes change which object
// `find` lands on all by themselves, so only updates need the copy above.
function updatedIds(args: DocumentSocketResponse): string[] {
  if (args.action !== 'update' || !Array.isArray(args.result)) return []
  return (args.result as ModifyDocumentUpdate[])
    .map((change) => change._id)
    .filter((id): id is string => typeof id === 'string')
}

// World-scoped handlers, registered once a world exists. Re-calling replaces
// the previous registration (same handler-slot semantics as before the
// registry refactor); no socket access is needed because the registries are
// socket-agnostic.
export function setupSocketListenersForWorld(world: Ref<GamePF2e | undefined>) {
  worldModifyUnsub?.()
  worldModifyUnsub = onModifyDocument((args: DocumentSocketResponse) => {
    switch (args.type) {
      case 'Combat': {
        // Round and turn live here, so this is the branch the header's turn bar
        // reads — see refreshCombatRefs for why the copy is not optional.
        const combats = asDocumentArray(world.value?.combats)
        processChanges(args, combats)
        refreshCombatRefs(combats, updatedIds(args))
        triggerRef(world)
        break
      }
      case 'Combatant': {
        const combatId = args.operation.parentUuid?.split('.')?.[1]
        const combats = asDocumentArray(world.value?.combats)
        const combat = combats?.find((c) => c._id === combatId) as
          | (DocumentData & { combatants?: unknown })
          | undefined
        if (combat) {
          processChanges(args, asDocumentArray(combat.combatants))
          refreshCombatRefs(combats, combatId ? [combatId] : [])
        }
        triggerRef(world)
        break
      }
      // User documents reach the app for the first time here.
      //
      // Needed because reactions and comments now live on their author's user
      // (utils/chatReactions.ts): without this branch, someone else's reaction
      // would not appear until the next full world fetch, and the app's own
      // write would only ever be visible through its optimistic guess. The
      // targeting-proxy flag rides along, which it previously only picked up on
      // a world refresh.
      case 'User':
        processChanges(args, asDocumentArray(world.value?.users))
        // Invalidate the cross-user reaction/comment indexes, exactly as the
        // ChatMessage branch below invalidates the message list: the mutation
        // above is in place, so nothing reading through the shallow `world` ref
        // would otherwise notice it.
        useWorldStore().bumpUsersRevision()
        break
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
    // Deliberately NOT a targeting source. Core's userActivity carries target
    // ids without the scene they belong to, so it can only be resolved by
    // guessing — and as a second writer of the same state it used to race the
    // module's scene-aware report and win by arriving last. The module's
    // SHARE_TARGETS self-report is the only path into the target store now.
    //
    // Its PRESENCE flag is another matter: it is the only signal that the client
    // whose targeting we mirror has gone away, and stale targets from a proxy
    // that logged out still resolve (see reportUserActivity).
    useTargetHelperStore().reportUserActivity(user, args.active)
    if (args.active) logger.info('user online', user, args)
  })
}

// Registers purely against module-level registries (no socket capture), so
// subscriptions are live immediately and survive socket swaps. Deliberately
// synchronous: useActorSync must hold the cleanup before a fast actor switch
// can unmount it — a `.then()`-delivered cleanup lands after onUnmounted has
// already run, leaking the registrations for the app's lifetime.
export function setupSocketListenersForActor(
  actorId: string,
  actor: Ref<TablemateActor | undefined>,
  refreshMethod: () => Promise<void>
): () => void {
  const removeRefresh = addRefresh(actorId, refreshMethod)

  // When a GM announces presence, re-fetch any actor still waiting on live
  // data. Three ways an actor can be waiting:
  //
  //   * inventory missing — never loaded;
  //   * flagged stale — painted from a cached snapshot, which already carries
  //     inventory, so gating on inventory alone would leave that sheet spinning
  //     forever when its initial request was dropped for want of a GM;
  //   * awaiting a refresh — a direct write fired one and nobody was listening
  //     to answer it. Without this arm the returning GM sent no payload, so the
  //     derived figures stayed behind while useDerivedStale stopped marking
  //     them (it gates on !isListening) — hiding the staleness at the exact
  //     moment it became fixable.
  const syncStatus = useSyncStatusStore()
  const unsubListener = onTmAction(TM.LISTENER_ONLINE, () => {
    if (
      !actor.value?.inventory ||
      syncStatus.staleActors.has(actorId) ||
      syncStatus.awaitingRefresh.has(actorId)
    ) {
      fireRefresh(actorId)
    }
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
            mergeDocumentChange(actor.value, result)
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
