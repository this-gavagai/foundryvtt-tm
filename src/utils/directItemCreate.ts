// Whether a compendium item can be added without a GM, and what to normalise
// if it can.
//
// Adding an item normally goes through ADD_COMPENDIUM_ITEM so that PF2e's
// creation pipeline runs on a Foundry client: ItemPF2e.createDocuments applies
// GrantItem, resolves ChoiceSets, updates sibling items, expands kits and sorts
// class features, and ItemPF2e#_preCreate adjusts the actor's hit points for a
// character-building item. None of that happens for a raw socket create, which
// is why the RPC exists and why it stays the default whenever a GM is listening.
//
// But a plain longsword asks nothing of that pipeline, and refusing to let a
// player buy gear because the GM's laptop is shut is a poor trade. So: when no
// GM is listening AND the item is one the pipeline would do nothing for, create
// it directly.
//
// ── What "nothing for" means, verified rather than assumed ──────────────────
//
// Checked against the live pf2e 8.4.1. Of the seven physical inventory types,
// NONE declares its own `_preCreate` — ConsumablePF2e, EquipmentPF2e,
// TreasurePF2e, ContainerPF2e, ArmorPF2e, ShieldPF2e and WeaponPF2e all inherit
// PhysicalItemPF2e's, which does exactly three things:
//
//   1. `containerId` → null unless it is a real 16-character id;
//   2. `delete system.apex.selected`;
//   3. `equipped = getDefaultEquipStatus(this)` — ONLY when there is no actor,
//      so it does not apply to a create onto a character at all.
//
// And ItemPF2e#_preCreate adds: the hit-point adjustment (only for ancestry /
// background / class / feat / heritage — all excluded below), a sort of
// `traits.value`, and stripping rules flagged `removeUponCreate` (moot with no
// rules). `normalizeDirectItemSource` below replicates the parts that apply.
//
// AmmoPF2e and SpellPF2e DO declare their own `_preCreate` and are excluded.
//
// ── What is still lost, and is not this module's to fix ─────────────────────
//
// The item lands correctly; what does not happen is the RE-DERIVATION. Bulk,
// encumbrance, container capacity and the strikes list are computed by PF2e on
// a client, so they stay as they were until a GM answers the refresh this create
// fires. That is surfaced rather than hidden — see composables/useDerivedStale
// and the note the compendium modal shows before offering a direct add.
//
// If any of this drifts, it drifts silently: re-check the `_preCreate` chain
// against the installed system rather than trusting this comment.
//
// ── Why the eligible TYPES stay physical-only ───────────────────────────────
//
// Recorded because the obvious next request is conditions: removing one is
// already a direct write (api/documents.ts walks PF2e's grant graph on the way
// out), so applying one looks like it should be symmetric. Measured against the
// installed pf2e 8.4.1 conditions pack, 31 of its 43 entries carry no
// creation-time rule at all — 24 with no rules whatsoever and 7 carrying only
// FlatModifier/Immunity — so a rule-key test alone would admit most of them.
//
// It is not the rules that stop this. `ItemPF2e.createDocuments` does work for
// `condition`/`effect`/`affliction` sources BEFORE any rule element runs, and
// none of it has a counterpart here:
//
//   • `actor.isImmuneTo(condition)` — the source is DROPPED, with a
//     notification, when the actor's IWR immunities match its roll options. A
//     socket create applies it regardless. This bites hardest on the NPC sheets,
//     where immunity is the norm rather than the exception.
//   • `actor.isAffectedBy(condition)` — the same drop for persistent damage the
//     actor cannot take (negative healing, alignment traits).
//   • Effects sharing a compendium source are deleted first, so re-applying one
//     replaces it rather than stacking.
//
// And a VALUED condition (Frightened 2, Clumsy 3) is raised through
// `actor.increaseCondition`, not created twice; a raw second create stores a
// duplicate that `ConditionPF2e#prepareSiblingData` merely deactivates, leaving
// the player a phantom row to clear.
//
// Reproducing three cascades to avoid one round trip is exactly the trade the
// lane rule warns about (gate 3, api/documents.ts), so conditions stay an RPC
// and AddConditionModal says so rather than guessing. What would change the
// answer is the immunity test moving somewhere both ends can read — not a
// cleverer rule-key allowlist.

import { inventoryTypes } from '@/utils/constants'

// Item types whose creation runs actor-level surgery in ItemPF2e#_preCreate
// (a hit-point recalculation from the actor's clone), and which therefore can
// never be created directly.
const CHARACTER_BUILDING_TYPES = new Set(['ancestry', 'background', 'class', 'feat', 'heritage'])

// The physical inventory types, which is also exactly the set verified above to
// carry no `_preCreate` of their own. Derived from the app's own list so a new
// inventory type cannot be silently admitted here.
const DIRECT_ELIGIBLE_TYPES = new Set(inventoryTypes.map((entry) => entry.type))

/**
 * Why an item cannot be added without a GM. Carried as a reason rather than a
 * bare false so the UI can say which limitation applied — a player told "not
 * without the GM" should learn whether that is about rules, choices, or the
 * kind of item.
 */
export type DirectAddRefusal =
  // Carries rule elements. Several kinds do real work at creation time —
  // GrantItem creates further items, ChoiceSet asks a question, others update
  // siblings — so any rule at all sends the item through the pipeline.
  | 'has-rules'
  // A kit expands into its contents and is not itself stored.
  | 'is-kit'
  // Ancestry / background / class / feat / heritage: creation adjusts the
  // actor's hit points.
  | 'character-building'
  // Ammunition and spells declare their own `_preCreate`; anything non-physical
  // is outside the verified set entirely.
  | 'needs-system'

export type DirectAddCheck = { eligible: true } | { eligible: false; reason: DirectAddRefusal }

// Permissive on purpose: this is asked about a raw compendium source AND about
// the display payload the modal already holds, whose `system` is typed with its
// own known fields. `unknown` lets both in and narrows at the one read below.
interface SourceLike {
  type?: unknown
  system?: unknown
}

/**
 * Can this compendium source be created straight over the socket?
 *
 * A POSITIVE test: eligible only for an enumerated set of types with an empty
 * rules array. Deliberately not a blocklist of known-troublesome rule keys.
 *
 * TEN rule-element keys do work at creation time in pf2e 8.4.1, by two separate
 * mechanisms, and a blocklist of the two famous ones would wave eight of them
 * through silently, because the create succeeds either way:
 *
 *   `preCreate`, run by ItemPF2e.createDocuments against an actor clone —
 *   ActiveEffectLike, BattleForm, ChoiceSet, GrantItem, ItemAlteration,
 *   RollOption, SpecialResource, TokenMark.
 *
 *   `onCreate`, run by ItemPF2e#_onCreate and gated on `game.user.id` being the
 *   CREATING user — TempHP, LoseHitPoints. A socket create has no client acting
 *   as that user, so these are skipped for the same reason `preUpdate` is
 *   (utils/actorUpdatePaths.ts, gate 2 in api/documents.ts).
 *
 * RollOption in that first list is the one worth remembering: it reads like
 * pure derived data and is not, which is what makes "obviously harmless rule
 * keys" the wrong axis to sort on.
 */
export function checkDirectAdd(source: SourceLike | null | undefined): DirectAddCheck {
  const type = typeof source?.type === 'string' ? source.type : ''
  if (type === 'kit') return { eligible: false, reason: 'is-kit' }
  if (CHARACTER_BUILDING_TYPES.has(type)) {
    return { eligible: false, reason: 'character-building' }
  }
  if (!DIRECT_ELIGIBLE_TYPES.has(type)) return { eligible: false, reason: 'needs-system' }

  const rules = (source?.system as { rules?: unknown } | null | undefined)?.rules
  // A missing array counts as empty: a source with no rules key has no rules.
  if (Array.isArray(rules) && rules.length > 0) return { eligible: false, reason: 'has-rules' }

  return { eligible: true }
}

/**
 * Apply the parts of PF2e's `_preCreate` that a raw socket create would skip.
 *
 * Only the three that apply to an eligible item parented to an actor — see the
 * verified list in this file's header. Mutates and returns the source.
 */
export function normalizeDirectItemSource(
  source: Record<string, unknown>
): Record<string, unknown> {
  const system = (source.system ??= {}) as Record<string, unknown>

  // PhysicalItemPF2e#_preCreate: anything that is not a real 16-character id is
  // cleared, and a compendium source has no container on this actor either way.
  const containerId = system.containerId
  if (typeof containerId !== 'string' || containerId.length !== 16) system.containerId = null

  // PhysicalItemPF2e#_preCreate: a selection authored into the pack would claim
  // this item is the character's chosen apex item.
  const apex = system.apex
  if (apex && typeof apex === 'object') delete (apex as Record<string, unknown>).selected

  // ItemPF2e#_preCreate sorts the source traits. Cosmetic — it decides the order
  // trait pills render in — but free to match, and a mismatch would show as the
  // same item reading differently depending on how it was added.
  const traits = system.traits
  if (traits && typeof traits === 'object') {
    const value = (traits as { value?: unknown }).value
    if (Array.isArray(value)) (value as string[]).sort()
  }

  return source
}
