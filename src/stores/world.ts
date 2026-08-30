import { computed, ref, shallowRef, triggerRef } from 'vue'
import { defineStore } from 'pinia'
import { debounce } from 'lodash-es'
import type { ActorPF2e, GamePF2e, UserPF2e } from '@7h3laughingman/pf2e-types'
import { useServerStore } from '@/stores/server'
import { useFoundryWorldStatusStore } from '@/stores/foundryWorldStatus'
import { markWorldRequestSent } from '@/api/loadPriority'
import { emitWithTimeout } from '@/api/socketConnection'
import { asDocumentArray, type DocumentData } from '@/api/internal'
import { collectionToArray, type CollectionLike } from '@/utils/foundryCollections'
import type { ChatReaction } from '@/utils/chatReactions'

const REFRESH_DEBOUNCE_MS = 2000
// 'world' is answered by the Foundry server itself, not by the module on a GM
// client — there is no handler for it in src/foundry. It is core's dump of
// every collection (packages/world.mjs calls db.Actor.dump() and friends with
// no user argument), so it is unfiltered and identical for every user: a
// player receives the same bytes a GM does, and permission only decides what
// the client displays. That makes it big — 26 MB on a mid-sized v14 world,
// dominated by scenes/settings/packs rather than actors — hence the generous
// budget. Selective, per-actor data is a separate request the GM does serve
// (see foundry/handlers/characterDetails), because the derived values a sheet
// needs don't survive the server's source-only dump.
//
// A timed-out request is simply dropped — the next refresh trigger (session
// handshake, world-progress trailing edge, visibility resume) retries.
const WORLD_REQUEST_TIMEOUT_MS = 15_000

export const useWorldStore = defineStore('world', () => {
  const world = shallowRef<GamePF2e | undefined>(undefined)

  // Counts in-place mutations to world.messages (creates/updates/deletes
  // arriving via modifyDocument — bumped by the socket handler). The chat
  // persistence watcher folds this into its change fingerprint: an *update* to
  // an older message (e.g. damage applied rewriting its content) changes
  // neither the message count nor the tail identity, so without this signal
  // the cached tail would silently keep the pre-edit copy.
  const messagesRevision = ref(0)
  function bumpMessagesRevision(): void {
    messagesRevision.value++
  }

  // Fold locally-created chat messages into world.messages. A message the app
  // posts directly (modifyDocument create over the socket) is echoed back to
  // the creator only as the emit's ack result, NOT as the 'modifyDocument'
  // broadcast that populates other clients — so the sender must self-apply or
  // its own message wouldn't appear until the next full world refresh. Keyed by
  // _id and idempotent, so it's harmless if a broadcast ever does also arrive
  // (mirrors processChanges' create guard). Bumps the revision + triggers the
  // shallowRef exactly like the incoming-broadcast path (serverEventWiring).
  function applyChatCreate(created: DocumentData[]): void {
    const root = asDocumentArray(world.value?.messages)
    if (!root) return
    let changed = false
    for (const msg of created) {
      if (msg._id && !root.find((m) => m._id === msg._id)) {
        root.push(msg)
        changed = true
      }
    }
    if (!changed) return
    messagesRevision.value++
    triggerRef(world)
  }

  // Fold a locally-issued chat edit into world.messages. Like applyChatCreate,
  // an update the app makes over the socket comes back only as the ack result,
  // not the broadcast that reaches other clients, so the editor must self-apply
  // or its own edit wouldn't show until the next full refresh. Shallow-merges
  // the changed fields (content) by _id; idempotent if a broadcast also lands.
  function applyChatUpdate(updated: DocumentData[]): void {
    const root = asDocumentArray(world.value?.messages)
    if (!root) return
    let changed = false
    for (const change of updated) {
      const item = change._id ? root.find((m) => m._id === change._id) : undefined
      if (item) {
        Object.assign(item, change)
        changed = true
      }
    }
    if (!changed) return
    messagesRevision.value++
    triggerRef(world)
  }

  // Write a message's emoji reaction list in place.
  //
  // Deliberately NOT applyChatUpdate: that shallow-Object.assigns the change
  // onto the message, so passing `{flags: {tablemate: {reactions}}}` through it
  // would replace the whole `flags` object — dropping flags.pf2e (roll context,
  // origin) and the tablemate voice-memo/image paths the row renders from. This
  // reaches only the one nested field.
  //
  // Used for both halves of the optimistic write in useChatActions.toggleReaction:
  // the immediate local guess, and the reconcile (or rollback) once the GM
  // answers. The authoritative broadcast lands via the normal modifyDocument
  // path, so this only has to cover the window before it arrives.
  function applyChatReactions(messageId: string, reactions: ChatReaction[]): void {
    const root = asDocumentArray(world.value?.messages)
    const message = root?.find((m) => m._id === messageId) as
      | (DocumentData & { flags?: { tablemate?: { reactions?: ChatReaction[] } } })
      | undefined
    if (!message) return
    message.flags ??= {}
    message.flags.tablemate ??= {}
    message.flags.tablemate.reactions = reactions
    messagesRevision.value++
    triggerRef(world)
  }

  // Write a voice memo's transcript (and the content copy that carries it into
  // Foundry's own chat log) in place, once the sending device's transcription
  // call returns — see attachVoiceMemoTranscript in useChatActions.
  //
  // Nested-write for the same reason as applyChatReactions: routing this through
  // applyChatUpdate would Object.assign the whole `flags` object over the
  // message and drop audioPath, i.e. the memo's own player.
  function applyChatTranscript(messageId: string, content: string, transcript: string): void {
    const root = asDocumentArray(world.value?.messages)
    const message = root?.find((m) => m._id === messageId) as
      | (DocumentData & { content?: string; flags?: { tablemate?: { transcript?: string } } })
      | undefined
    if (!message) return
    message.content = content
    message.flags ??= {}
    message.flags.tablemate ??= {}
    message.flags.tablemate.transcript = transcript
    messagesRevision.value++
    triggerRef(world)
  }

  // Fold a locally-issued chat delete into world.messages (see applyChatUpdate
  // for why self-apply is needed). Removes by _id; idempotent.
  function applyChatDelete(ids: string[]): void {
    const root = asDocumentArray(world.value?.messages)
    if (!root) return
    let changed = false
    for (const id of ids) {
      const index = root.findIndex((m) => m._id === id)
      if (index !== -1) {
        root.splice(index, 1)
        changed = true
      }
    }
    if (!changed) return
    messagesRevision.value++
    triggerRef(world)
  }

  // Indexed lookups. Consumers repeatedly resolve an actor or user by _id
  // (each mounted CharacterSheet finds its own actor, SideMenu/FamiliarSheet/
  // EquipmentList/targetHelper find theirs) — and world is a shallowRef
  // force-triggered on every modifyDocument, so those O(n) scans re-ran across
  // all consumers on every combat tick. Build the id→doc map once per world
  // change here and hand out O(1) lookups instead.
  const actorsById = computed(() => {
    const map = new Map<string, ActorPF2e>()
    for (const actor of collectionToArray<ActorPF2e>(
      world.value?.actors as CollectionLike<ActorPF2e>
    )) {
      if (actor._id) map.set(actor._id, actor)
    }
    return map
  })
  const usersById = computed(() => {
    const map = new Map<string, UserPF2e>()
    for (const user of collectionToArray<UserPF2e>(
      world.value?.users as CollectionLike<UserPF2e>
    )) {
      if (user._id) map.set(user._id, user)
    }
    return map
  })
  function actorById(id: string | null | undefined): ActorPF2e | undefined {
    return id ? actorsById.value.get(id) : undefined
  }
  function userById(id: string | null | undefined): UserPF2e | undefined {
    return id ? usersById.value.get(id) : undefined
  }

  // Foundry treats ASSISTANT (role 3) and GAMEMASTER (role 4) alike for document
  // ownership: User#isGM is `hasRole(ASSISTANT)`, and Document#testUserPermission
  // short-circuits to true for any such user. Every app-side ownership gate has
  // to match that, because a GM is rarely named in an actor's ownership map —
  // read literally they'd own nothing, while the Foundry side happily serves
  // them every actor in the world.
  const GM_ROLE = 3
  const currentUserIsGM = computed(() => {
    const id = (world.value as { userId?: string } | undefined)?.userId
    return ((userById(id) as { role?: number } | undefined)?.role ?? 0) >= GM_ROLE
  })

  async function sendWorldRequest(): Promise<void> {
    // Check /api/status first — works regardless of auth state.
    const worldStatus = useFoundryWorldStatusStore()
    const running = await worldStatus.fetchWorldStatus()
    if (running === false) {
      worldStatus.markWorldInactive()
      // No world request will go out — release the sheets gated behind it so
      // they don't sit out the full loadPriority fallback timeout.
      markWorldRequestSent()
      return
    }
    if (running === true) worldStatus.markWorldLoaded()

    // World is running (or status check failed) — try to get world data via socket.
    // Don't downgrade worldAuthenticated on transient socket failures — the
    // last-known state stays visible until a healthy round-trip arrives.
    const socket = await useServerStore()
      .getSocket()
      .catch(() => null)
    if (!socket) {
      markWorldRequestSent()
      return
    }

    const request = emitWithTimeout<GamePF2e>(socket, 'world', WORLD_REQUEST_TIMEOUT_MS)
    // The world request is now out — release any non-active character sheets
    // gated behind it so they slot in after the world (see loadPriority).
    markWorldRequestSent()

    try {
      const r = await request
      // A valid world response always includes a userId. An empty object or
      // a response without userId means the world is not active.
      worldStatus.setWorldAuthenticated(!!r?.userId)
      if (r?.userId) world.value = r
    } catch {
      // No ack before the timeout. Don't downgrade worldAuthenticated — the
      // last-known state stays visible until a healthy round-trip arrives
      // (same policy as the socket-acquisition failure above).
    }
  }

  // Fire an immediate world refresh so worldLoaded gets a definite value
  // (via /api/status, which doesn't need auth) before the spinner has a
  // chance to camp on `undefined`. Without this, a PWA cold-launch where
  // the socket connects but the `session` event is slow leaves the app
  // stuck on the spinner.
  const refreshWorld = debounce(sendWorldRequest, REFRESH_DEBOUNCE_MS, {
    leading: true,
    trailing: false
  })
  const refreshWorldNow = sendWorldRequest

  // Kick off the first world fetch. Kept out of the store setup body (and behind
  // an idempotent guard) so merely using the store — e.g. in a unit test —
  // doesn't fire a network request; the app calls start() once at bootstrap.
  let started = false
  function start(): void {
    if (started) return
    started = true
    refreshWorld()
  }

  // Drop the last-known world so stale actors/ownership from a previous
  // session can't be checked against a new user. Called on a genuine
  // identity change (server/user switch), not on same-user reconnects —
  // those intentionally keep the stale world visible until fresh data lands.
  function clearWorld(): void {
    world.value = undefined
    // sendWorldRequest sets these two together, so they have to be cleared
    // together. Leaving worldAuthenticated `true` over an absent world is the
    // one combination the app can't render: it satisfies every readiness gate
    // in ConnectedApp while actorIdsWhere returns nothing, which used to paint
    // an empty character list — a blank screen with no spinner and no way out.
    useFoundryWorldStatusStore().setWorldAuthenticated(undefined)
  }

  return {
    world,
    messagesRevision,
    bumpMessagesRevision,
    applyChatCreate,
    applyChatUpdate,
    applyChatReactions,
    applyChatTranscript,
    applyChatDelete,
    actorsById,
    usersById,
    actorById,
    userById,
    currentUserIsGM,
    refreshWorld,
    refreshWorldNow,
    clearWorld,
    start
  }
})
