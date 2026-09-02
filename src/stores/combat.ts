import { computed } from 'vue'
import { defineStore, storeToRefs } from 'pinia'
import { useWorldStore } from '@/stores/world'
import { useVersionCompatStore } from '@/stores/versionCompat'
import { nextTurn } from '@/api/actionRpc'
import { collectionToArray, type CollectionLike } from '@/utils/foundryCollections'
import { tokenPortrait, type PortraitRing } from '@/utils/tokenPortrait'

// Encounter state as the app sees it.
//
// IMPORTANT: everything under `world` is Foundry's SOURCE dump — plain JSON, not
// live documents (see stores/world.ts). So `Combat#turns`, `Combat#combatant`,
// `Combatant#name` and `Combatant#actor` — every derived value the Foundry-side
// tracker reads — simply do not exist here. `turn` is an index into the sorted
// turn order, which means the app has to reproduce that sort to know who is up.
// The types below are structural for the same reason: the PF2e/Foundry classes
// describe prepared documents, and claiming them for wire JSON is how you end up
// calling a method that isn't there.

// CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
const OWNER = 3
// Foundry treats ASSISTANT (3) and GAMEMASTER (4) alike for ownership.
const GM_ROLE = 3

interface TokenSource {
  _id?: string | null
  name?: string | null
  actorId?: string | null
  texture?: { src?: string | null; scaleX?: number | null; scaleY?: number | null } | null
  ring?: {
    enabled?: boolean | null
    colors?: { ring?: unknown; background?: unknown } | null
    subject?: { texture?: string | null; scale?: number | null } | null
  } | null
  width?: number | null
  height?: number | null
}

interface SceneSource {
  _id?: string | null
  active?: boolean
  tokens?: CollectionLike<TokenSource>
}

interface CombatantSource {
  _id?: string | null
  actorId?: string | null
  tokenId?: string | null
  sceneId?: string | null
  name?: string | null
  img?: string | null
  initiative?: number | null
  hidden?: boolean
  defeated?: boolean
  flags?: { pf2e?: { overridePriority?: Record<string, number | null> | null } | null } | null
}

// Note what is NOT here: `started`. `Combat#started` is a GETTER on the live
// document (`turns.length > 0 && round > 0`), never a stored field — it does not
// appear anywhere in a world's saved encounters, so reading it off the dump
// silently yields undefined and every encounter reads as not yet begun. It is
// derived below instead. `active` IS stored, which is why activeCombat works.
interface CombatSource {
  _id?: string | null
  active?: boolean
  scene?: string | null
  round?: number | null
  turn?: number | null
  combatants?: CollectionLike<CombatantSource>
}

interface ActorSource {
  _id?: string | null
  name?: string | null
  img?: string | null
  ownership?: Record<string, number> | null
  prototypeToken?: TokenSource | null
}

// One row of the turn order, with everything the header bar draws.
export interface TurnOrderEntry {
  id: string
  actorId: string | undefined
  name: string
  initiative: number | null
  defeated: boolean
  // Owned by the user looking at this app. This is the "your turn" test, and
  // that is all it is for — the strip deliberately does not mark owned
  // combatants, since the portrait already says which one is yours.
  //
  // Deliberately NOT satisfied by GM role: a GM owns every actor in Foundry's
  // model, so a role-based answer would announce every goblin's turn as theirs.
  // A GM who is also explicitly an owner (their own PC in a mixed game) matches.
  isMine: boolean
  isCurrent: boolean
  // First entry that belongs to the NEXT round, i.e. the one the round divider
  // is drawn in front of. Set on exactly one entry, and only when part of the
  // next round is actually on screen — see turnOrder.
  startsNewRound: boolean
  portraitUrl: string | undefined
  portraitScaleX: number
  portraitScaleY: number
  portraitRing: PortraitRing | undefined
}

export const useCombatStore = defineStore('combat', () => {
  const worldStore = useWorldStore()
  const { world, currentUserIsGM } = storeToRefs(worldStore)
  const { supportsEndTurn } = storeToRefs(useVersionCompatStore())

  const activeScene = computed(() => world.value?.scenes?.find((s) => s.active))
  const activeCombat = computed(() => world.value?.combats.find((c) => c.active))

  // The same object, read as the wire JSON it actually is.
  const combatSource = computed(() => activeCombat.value as CombatSource | undefined)
  const currentUserId = computed(
    () => (world.value as { userId?: string } | undefined)?.userId ?? ''
  )

  // Whether ANY non-GM user owns this actor — Foundry's `hasPlayerOwner`, which
  // PF2e's initiative tiebreak reads (see sortComparator). Reproduced rather
  // than read off the actor because it is derived data: the dump carries the
  // ownership map, not the conclusion.
  function hasPlayerOwner(actor: ActorSource | undefined): boolean {
    const ownership = actor?.ownership
    if (!ownership) return false
    for (const [userId, level] of Object.entries(ownership)) {
      if (level < OWNER) continue
      if (userId === 'default') return true
      const role = (worldStore.userById(userId) as { role?: number } | undefined)?.role ?? 0
      if (role < GM_ROLE) return true
    }
    return false
  }

  // PF2e's tiebreak priority: NPCs (1) act before player-owned creatures (2) on
  // an exact initiative tie. Every actor type that joins an encounter derives it
  // the same way — `hasPlayerOwner ? 2 : 1` — so one rule covers characters,
  // NPCs, hazards and armies alike. 3 is PF2e's own fallback for a combatant
  // whose actor it cannot resolve (an orphan left by a deleted actor).
  function tiebreakPriority(actorId: string | null | undefined): number {
    const actor = worldStore.actorById(actorId) as ActorSource | undefined
    if (!actor) return 3
    return hasPlayerOwner(actor) ? 2 : 1
  }

  // The turn order, sorted the way the Foundry-side encounter sorts it. This has
  // to match: `combat.turn` is an index into that order, so a different sort
  // doesn't mis-label one row — it points the whole bar at the wrong combatant.
  //
  // Mirrors EncounterPF2e#_sortCombatants: initiative descending, and on an
  // EXACT numeric tie a per-initiative override priority (set when a GM drags
  // tied combatants into an explicit order), then the actor's tiebreak priority,
  // then combatant id. An unrolled combatant (null initiative) has no tie to
  // break and falls to the end via core's -Infinity.
  function sortComparator(a: CombatantSource, b: CombatantSource): number {
    const tied =
      typeof a.initiative === 'number' &&
      typeof b.initiative === 'number' &&
      a.initiative === b.initiative
    if (tied) {
      const priority = (c: CombatantSource) =>
        c.flags?.pf2e?.overridePriority?.[String(c.initiative)] ?? tiebreakPriority(c.actorId)
      const [pa, pb] = [priority(a), priority(b)]
      if (pa !== pb) return pa - pb
      return (a._id ?? '').localeCompare(b._id ?? '')
    }
    const ia = typeof a.initiative === 'number' ? a.initiative : -Infinity
    const ib = typeof b.initiative === 'number' ? b.initiative : -Infinity
    return ib - ia || (a._id ?? '').localeCompare(b._id ?? '')
  }

  // Placed tokens of the encounter's scene, by id. A combatant's name and art
  // come from its token, not from the combatant itself (both fields are null in
  // the source unless a GM overrode them).
  const sceneTokens = computed(() => {
    const combat = combatSource.value
    if (!combat) return new Map<string, TokenSource>()
    const scenes = collectionToArray<SceneSource>(
      world.value?.scenes as CollectionLike<SceneSource>
    )
    const scene = scenes.find((s) => s._id === combat.scene) ?? scenes.find((s) => s.active)
    const map = new Map<string, TokenSource>()
    for (const token of collectionToArray(scene?.tokens)) {
      if (token._id) map.set(token._id, token)
    }
    return map
  })

  // Does the user looking at this app own the actor? See TurnOrderEntry.isMine.
  function ownedByCurrentUser(actorId: string | null | undefined): boolean {
    const ownership = (worldStore.actorById(actorId) as ActorSource | undefined)?.ownership
    if (!ownership || !currentUserId.value) return false
    return (ownership[currentUserId.value] ?? ownership.default ?? 0) >= OWNER
  }

  // Every combatant in turn order, including the ones a player must not see —
  // `combat.turn` counts those too, so they cannot be filtered before indexing.
  const allTurns = computed<CombatantSource[]>(() =>
    [...collectionToArray(combatSource.value?.combatants)].sort(sortComparator)
  )

  const round = computed(() => combatSource.value?.round ?? 0)

  // Has the GM pressed "Begin Encounter"? Derived exactly as core's
  // `Combat#started` getter derives it — combatants present and past round 0 —
  // because that getter is all there is: the field is not stored (see
  // CombatSource). Reading `combat.started` off the dump instead left every
  // live encounter reading as "Not started".
  const started = computed(() => round.value > 0 && allTurns.value.length > 0)

  // The current turn as an index into the sorted order, or -1 when there is no
  // turn to be on (before the encounter begins).
  const turnIndex = computed(() => {
    const turn = combatSource.value?.turn
    return started.value && typeof turn === 'number' ? turn : -1
  })

  function entryFor(
    combatant: CombatantSource,
    index: number,
    startsNewRound = false
  ): TurnOrderEntry {
    const token = combatant.tokenId ? sceneTokens.value.get(combatant.tokenId) : undefined
    const actor = worldStore.actorById(combatant.actorId) as ActorSource | undefined
    // Token art first (per-token image, scale and dynamic ring), then the
    // actor's prototype token — the derivation every other portrait in the app
    // uses (see useChatMessages.speakerPortrait).
    const portrait = token?.texture?.src
      ? tokenPortrait(token)
      : tokenPortrait(actor?.prototypeToken, combatant.img ?? actor?.img ?? undefined)
    return {
      id: combatant._id ?? '',
      actorId: combatant.actorId ?? undefined,
      name: combatant.name || token?.name || actor?.name || '',
      initiative: typeof combatant.initiative === 'number' ? combatant.initiative : null,
      defeated: combatant.defeated === true,
      isMine: ownedByCurrentUser(combatant.actorId),
      isCurrent: index === turnIndex.value,
      startsNewRound,
      portraitUrl: portrait.url,
      portraitScaleX: portrait.scaleX,
      portraitScaleY: portrait.scaleY,
      portraitRing: portrait.ring
    }
  }

  // What the turn bar draws: one full cycle of the initiative order, ROTATED so
  // whoever is up sits at the left edge. Read left to right it is "acting now,
  // then next, then next" — the question a player in an encounter is actually
  // asking. Initiative order alone would make them hunt for the highlight and
  // then read wrapping around the end.
  //
  // The wrapped tail belongs to the NEXT round, so the first entry of it carries
  // startsNewRound and the bar draws a divider in front of it. That flag is
  // assigned AFTER hiding, not before: if the top-of-initiative combatant is
  // hidden from this user, the divider has to move to the first entry they can
  // actually see, or it lands in the wrong place (or nowhere).
  //
  // Two cases produce no divider, both correctly: an encounter that has not
  // begun (no rotation, plain initiative order), and a turn sitting on the top
  // of the initiative order, where the whole strip is this round already.
  //
  // Hiding happens only AFTER the sort and the rotation, since `combat.turn`
  // indexes the unfiltered order. A hidden combatant's turn therefore shows as a
  // strip with nobody marked current, which is the honest answer: the player is
  // not allowed to know who is up.
  const turnOrder = computed<TurnOrderEntry[]>(() => {
    const turns = allTurns.value
    const pivot = turnIndex.value
    const rotated =
      pivot > 0
        ? [...turns.slice(pivot), ...turns.slice(0, pivot)].map((combatant, offset) => ({
            combatant,
            // Index in the UNROTATED order, which is what isCurrent compares
            // against and what identifies the next-round tail.
            index: (pivot + offset) % turns.length
          }))
        : turns.map((combatant, index) => ({ combatant, index }))

    const visible = rotated.filter(
      ({ combatant }) => currentUserIsGM.value || combatant.hidden !== true
    )
    const breakAt = pivot > 0 ? visible.findIndex(({ index }) => index < pivot) : -1
    return visible.map(({ combatant, index }, position) =>
      entryFor(combatant, index, position === breakAt)
    )
  })

  // The combatant holding the turn, or undefined when the encounter hasn't
  // started. Resolved from the UNFILTERED order, so the store still knows whose
  // turn it is (and whether it is yours) even when that combatant is hidden.
  const currentCombatant = computed<TurnOrderEntry | undefined>(() => {
    const combatant = allTurns.value[turnIndex.value]
    return combatant ? entryFor(combatant, turnIndex.value) : undefined
  })

  const isMyTurn = computed(() => currentCombatant.value?.isMine === true)

  // A player may end their own character's turn; a GM may end anyone's, as they
  // can in Foundry. Both need a module new enough to have the handler — see
  // supportsEndTurn.
  // `actorId` is part of the test, not just of the payload: the request names
  // the actor whose turn it is, so a combatant without one (an orphan left by a
  // deleted actor) cannot be ended through this path at all. Without it here,
  // canEndTurn said yes, the button rendered, and endTurn returned without
  // sending anything — a button that does nothing, silently, which is the worst
  // of the three possible answers.
  const canEndTurn = computed(
    () =>
      !!currentCombatant.value?.actorId &&
      supportsEndTurn.value &&
      (isMyTurn.value || currentUserIsGM.value)
  )

  // End the current turn. The round/turn the app is showing rides along so the
  // module can refuse a tap that queued behind a slow request and no longer
  // describes the live encounter (see foundry/handlers/nextTurn.ts) — better a
  // failed button than skipping the next player.
  //
  // Throws rather than returning quietly when there is nothing to end: every
  // caller is a button press, and a press that cannot do anything has to say so.
  // canEndTurn already covers each of these, so reaching one is a bug, not a
  // state the UI is expected to sit in.
  async function endTurn(): Promise<void> {
    const combat = combatSource.value
    const actorId = currentCombatant.value?.actorId
    if (!combat?._id || !actorId || turnIndex.value < 0) {
      throw new Error('no turn to end')
    }
    await nextTurn(actorId, {
      combatId: combat._id,
      round: round.value,
      turn: turnIndex.value
    })
  }

  return {
    activeScene,
    activeCombat,
    round,
    started,
    turnIndex,
    turnOrder,
    currentCombatant,
    isMyTurn,
    canEndTurn,
    ownedByCurrentUser,
    endTurn
  }
})
