// Roll-construction and roll-result helpers.
//
// FoundryRoll is a deliberate strengthening of Foundry's own Roll, not a
// redescription of it, and it makes exactly two claims the upstream type cannot:
//
//   total is non-optional. Upstream it is `number | undefined`, because it is
//   unset until evaluate() resolves — and everything here has awaited that.
//
//   each die term has a face count. Upstream `DiceTerm.faces` is `number | void`
//   because a coin or fate die has none; every formula this module builds rolls
//   dN terms, so every term it gets back has faces. The wire type the app reads
//   (RolledDie) says the same thing, so the payload needs no assertion.
//
// Both are asserted in one place, rollClass() below, with a single `as` — the
// compiler still checks that Roll and FoundryRoll describe the same class.

import type { ActorPF2e, GamePF2e } from '@7h3laughingman/pf2e-types'
import type { RolledDie, RollResult } from '@/types/api-types'
import { makeFakeEvent } from './foundry'
import { diceRollClasses } from '../globals'

// Structural shape of an evaluated Foundry Roll instance.
export type FoundryRoll = {
  formula: string
  total: number
  result: string
  dice: RolledDie[]
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

// Foundry's Roll constructor, narrowed to FoundryRoll. Lives here rather than in
// globals.ts because FoundryRoll is this module's type and the narrowing is the
// whole point; see the header for what the narrowing claims.
export function rollClass(): new (formula: string) => FoundryRoll {
  return Roll as new (formula: string) => FoundryRoll
}

// Look up PF2e's DamageRoll subclass from CONFIG.Dice.rolls. Returns undefined
// if PF2e hasn't finished registering its roll classes yet — callers should
// gracefully fall back to a plain Roll.
export function getDamageRollClass(): DamageRollCtor | undefined {
  return diceRollClasses().find((r) => r.name === 'DamageRoll') as DamageRollCtor | undefined
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
  const damageRoll = DamageRoll
    ? new DamageRoll(formula, opts.rollData ?? {})
    : new (rollClass())(formula)
  await damageRoll.evaluate()
  await damageRoll.toMessage(
    { speaker: { actor: actor._id ?? undefined } },
    opts.rollMode ? { rollMode: opts.rollMode } : undefined
  )
  return damageRoll
}

// The stand-in event, with a target carrying [data-cast-rank] — so
// SpellPF2e.rollDamage (which calls htmlClosest(event.target, "[data-cast-rank]")
// — see ~/pf2e/src/module/item/spell/document.ts) can read the cast rank and run
// its own loadVariant + heightening dispatch. Lets us delegate heightening to
// PF2e instead of hand-rolling it. See makeFakeEvent for why it isn't a real
// event; the element is real, because htmlClosest does an `instanceof Element`
// check on it.
export function makeCastRankEvent(source: GamePF2e, castRank: number | undefined): PointerEvent {
  if (!castRank) return makeFakeEvent(source)
  const target = document.createElement('span')
  target.dataset.castRank = String(castRank)
  return makeFakeEvent(source, target)
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
