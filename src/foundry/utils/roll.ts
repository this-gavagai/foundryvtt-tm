// Roll-construction and roll-result helpers. The local `declare const Roll`
// and `declare const CONFIG` below intentionally shadow the wider ambient
// types from pf2e-types / foundry-types — we need narrower shapes that
// guarantee the methods/fields we touch (FoundryRoll.total is non-optional,
// CONFIG.Dice.rolls items are DamageRollCtor). Other modules that need these
// narrowed shapes repeat the same `declare` pattern at their top — see
// foundry-globals.d.ts for the rationale.

import type { ActorPF2e, GamePF2e } from '@7h3laughingman/pf2e-types'
import type { RollResult } from '@/types/api-types'
import { makeFakeEvent } from './foundry'

// Structural shape of an evaluated Foundry Roll instance.
export type FoundryRoll = {
  formula: string
  total: number
  result: string
  dice: { faces: number; results: { result: number }[] }[]
  evaluate: () => Promise<FoundryRoll>
  toMessage: (
    data?: { speaker?: { actor?: string }; flavor?: string },
    opts?: { rollMode?: 'publicroll' | 'gmroll' | 'blindroll' | 'selfroll' }
  ) => Promise<unknown>
}

// Constructor signature for PF2e's DamageRoll subclass.
export type DamageRollCtor = new (
  formula: string,
  data?: object,
  options?: object
) => FoundryRoll & {
  toMessage: (
    data?: { speaker?: { actor?: string }; flavor?: string },
    opts?: { rollMode?: 'publicroll' | 'gmroll' | 'blindroll' | 'selfroll' }
  ) => Promise<unknown>
}

declare const Roll: new (formula: string) => FoundryRoll
declare const CONFIG: {
  Dice: { rolls: Array<DamageRollCtor & { name: string }> }
  PF2E: Record<string, unknown>
}

// Look up PF2e's DamageRoll subclass from CONFIG.Dice.rolls. Returns undefined
// if PF2e hasn't finished registering its roll classes yet — callers should
// gracefully fall back to a plain Roll.
export function getDamageRollClass(): DamageRollCtor | undefined {
  return CONFIG.Dice.rolls.find((r) => r.name === 'DamageRoll')
}

// Build a PF2e DamageRoll from a formula string, evaluate it, and post it to
// chat as the given actor. Used wherever we have a raw formula and want a
// typed damage chat card (inline @Damage in descriptions, the side-menu free
// damage builder, etc.). Falls back to plain Roll if DamageRoll isn't yet
// registered — preserves a usable (if untyped) output during system-load races.
export async function rollDamageFormulaToMessage(
  formula: string,
  actor: ActorPF2e,
  opts: {
    rollMode?: 'publicroll' | 'gmroll' | 'blindroll' | 'selfroll'
    rollData?: object
  } = {}
): Promise<FoundryRoll> {
  const DamageRoll = getDamageRollClass()
  const damageRoll = DamageRoll ? new DamageRoll(formula, opts.rollData ?? {}) : new Roll(formula)
  await damageRoll.evaluate()
  await damageRoll.toMessage(
    { speaker: { actor: actor._id ?? undefined } },
    opts.rollMode ? { rollMode: opts.rollMode } : undefined
  )
  return damageRoll
}

// Build a synthetic PointerEvent whose target carries [data-cast-rank], so
// SpellPF2e.rollDamage (which calls htmlClosest(event.target, "[data-cast-rank]")
// — see ~/pf2e/src/module/item/spell/document.ts) can read the cast rank and
// run its own loadVariant + heightening dispatch. Lets us delegate heightening
// to PF2e instead of hand-rolling it.
// htmlClosest does an `instanceof Element` check, so target must be a real
// DOM element, not a plain object.
export function makeCastRankEvent(source: GamePF2e, castRank: number | undefined): PointerEvent {
  const base = makeFakeEvent(source)
  if (!castRank) return base as unknown as PointerEvent
  const target = document.createElement('span')
  target.dataset.castRank = String(castRank)
  return { ...base, target } as unknown as PointerEvent
}

// PF2e's roll-producing methods return polymorphic shapes:
//   - Statistic checks resolve to a single roll object
//   - Strike .roll() returns an array of variants, the first carrying a `.roll`
//   - Some paths return the roll wrapped inside `{ roll: ... }`
// Normalizes those into the { formula, result, total, dice, isSecret } payload
// the client expects.
type RollResultShape = {
  formula?: unknown
  result?: unknown
  total?: unknown
  dice?: unknown
  roll?: { formula?: unknown; result?: unknown; total?: unknown; dice?: unknown }
  [n: number]: { message?: { whisper?: string[] } } | undefined
}

export function extractRollPayload(
  rRaw: unknown,
  args: { userId: string; options?: object }
): { roll?: RollResult } {
  if (!rRaw) return {}
  const r = rRaw as RollResultShape
  // r[0] handles array-form results (e.g. strike variants); hasOwnProperty
  // guards against the inherited Roll.prototype.roll() method being mistaken
  // for a data wrapper.
  const rollEl = r[0] ?? r
  const actualRoll = (
    Object.prototype.hasOwnProperty.call(rollEl, 'roll') ? (rollEl as RollResultShape).roll : rollEl
  ) as RollResultShape | undefined
  // Secret detection has two paths:
  //   1. Strike/action results carry message.whisper — non-empty recipients
  //      that exclude the calling user mean it's hidden from them.
  //   2. PF2e's Statistic.roll returns a bare CheckRoll with no message data;
  //      for those we rely on the requested visibility in args.options
  //      (messageMode: "blind" | "gm" for PF2e, rollMode: "blindroll" |
  //      "gmroll" for raw Foundry rolls).
  const opts = (args.options ?? {}) as { messageMode?: string; rollMode?: string }
  const requestedHidden =
    opts.messageMode === 'blind' ||
    opts.messageMode === 'gm' ||
    opts.rollMode === 'blindroll' ||
    opts.rollMode === 'gmroll'
  const whisperHidden =
    (r?.[0]?.message?.whisper?.length ?? 0) > 0 && !r?.[0]?.message?.whisper?.includes(args.userId)
  const isSecret = whisperHidden || requestedHidden
  const { formula, result, total, dice } = actualRoll ?? {}
  // Typed local so RollResult's field names/arity stay compiler-checked; the
  // values come off PF2e's untyped roll shapes, so each leaf is asserted.
  const roll: RollResult = {
    formula: formula as string,
    result: result as string,
    total: total as number,
    dice: dice as RollResult['dice'],
    isSecret
  }
  return { roll }
}
