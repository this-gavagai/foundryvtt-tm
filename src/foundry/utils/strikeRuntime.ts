// Structural types for the PF2e strike-action runtime objects living on
// actor.system.actions, plus the lookup every strike-related handler shares.

import type { ActorPF2e } from '@7h3laughingman/pf2e-types'

export type StrikeRollFn = (opts: object) => Promise<unknown>

// A variant's roll. Widened to allow no return because an area attack's does
// not have one: it rolls for effect against everything in the template and
// returns void, where a strike's resolves to the roll. Reached through
// altUsages, which PF2e types as strikes-or-area-attacks; callers wrap the
// result in Promise.resolve.
export type StrikeVariantRollFn = (opts: object) => Promise<unknown> | void

export type StrikeActionRuntime = {
  slug: string
  // `type` distinguishes a strike from the other action shapes that can appear
  // in an altUsages list; `item.isMelee` is how PF2e itself decides whether a
  // usage is the melee or the ranged one.
  type?: string
  item: { dealsDamage: boolean; id?: string; isMelee?: boolean } | null
  altUsages?: StrikeActionRuntime[]
  variants: { label: string; roll: StrikeVariantRollFn }[]
  // Optional, as PF2e declares them: a strike whose weapon deals no damage
  // (a grapple-only unarmed form, an area attack) carries neither.
  damage?: StrikeRollFn
  critical?: StrikeRollFn
}

// How a caller names the strike it wants.
//
// Two forms, because the two callers know different things:
//
//   altUsage — an INDEX into altUsages. What the sheet sends: it renders the
//              list, so it knows the position it drew.
//   itemId + usage — the weapon and whether this is its melee or ranged usage.
//              What a posted strike CARD carries: PF2e stamps
//              `data-identifier="<itemId>.<slug>.<melee|ranged>"` on it and has
//              no index to give.
//
// `usage` wins when both are present.
export interface StrikeRef {
  actionSlug: string
  altUsage?: number
  itemId?: string
  usage?: 'melee' | 'ranged'
}

function usageOf(action: StrikeActionRuntime): string | undefined {
  if (action.type && action.type !== 'strike') return action.type
  if (action.item?.isMelee === undefined) return undefined
  return action.item.isMelee ? 'melee' : 'ranged'
}

// Resolve the strike a request names. The usage branch is a port of PF2e's own
// resolution for chat cards (ChatMessagePF2e#_attack): match the base action by
// slug — and by weapon id when one is given, since two actions can share a slug
// — then pick from the base plus its alternate usages the one whose melee/ranged
// form matches. Falling back to the base rather than returning nothing keeps a
// card readable when a usage disappears (the weapon was unequipped or changed).
export function findStrikeAction(
  actor: ActorPF2e,
  ref: StrikeRef
): StrikeActionRuntime | undefined {
  // system.actions holds area attacks (an NPC "area fire" item, a character's
  // auto-fire) alongside strikes, and those are a different shape: their
  // variants roll for effect and return void rather than a roll. They aren't
  // rollable through this path and the app never offers them here — see the
  // strikes computed in composables/npc.ts — so drop them at the door rather
  // than hand one back for a caller to invoke as a strike.
  const all = actor.isOfType('character', 'npc') ? actor.system.actions : []
  const actions: StrikeActionRuntime[] = all.filter((a) => a.type === 'strike')
  const base =
    (ref.itemId
      ? actions.find((a) => a.slug === ref.actionSlug && a.item?.id === ref.itemId)
      : undefined) ?? actions.find((a) => a.slug === ref.actionSlug)
  if (!base) return undefined

  if (ref.usage) {
    const usages = [base, ...(base.altUsages ?? [])]
    return usages.find((a) => usageOf(a) === ref.usage) ?? base
  }
  return ref.altUsage !== undefined ? base.altUsages?.[ref.altUsage] : base
}
