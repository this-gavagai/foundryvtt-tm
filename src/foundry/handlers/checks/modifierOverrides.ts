import type { ActorPF2e, Modifier, Statistic } from '@7h3laughingman/pf2e-types'

// Per-modifier enabled-state overrides for a single roll. Keys are modifier
// slugs; values are the user's desired `enabled` for the duration of the
// roll. Read from `ctx.args.options.modifierOverrides` by each statistic
// handler.
export type ModifierOverrideMap = Record<string, boolean>

// Run `doRoll` with the given slug→enabled overrides applied to the live
// Modifier instances on a statistic, then restore everything.
//
// Background:
//   PF2e's statistic.roll() generally produces a contextual clone of the
//   actor (`actor.getContextualClone`) and reads modifiers off the clone's
//   own freshly-built Statistic instance — mutating modifiers on the
//   original actor doesn't reach the modifiers used in the final roll.
//   To make the override effective in both cases we:
//     1. Mutate the source statistic's modifiers (covers no-clone rolls —
//        skill/save checks with no target etc).
//     2. Wrap actor.getContextualClone so any clone produced during the
//        roll gets the same mutation applied to its statistic's modifiers
//        on the way out.
//
//   Mutation itself sets `enabled` + `ignored` to the requested values and
//   shadows the modifier's prototype `test()` method with a no-op so PF2e's
//   stacking calculator (which would re-derive `enabled` from the predicate
//   inside CheckModifier construction) can't undo the override. Stacking
//   still runs; for "disable" we set ignored=true so stacking keeps it
//   disabled. For "enable" we set ignored=false, putting the modifier back
//   in the stacking pool — if a higher-priority same-type sibling still
//   wins, PF2e's normal stacking still applies.
//
//   All mutations restore in `finally`, so the actor (and clone, while it
//   exists) returns to its prior state once the roll resolves.

type MutableModifier = Modifier & {
  test: (options: string[] | Set<string>) => void
  ignored: boolean
  adjustments: unknown[]
  predicate: { length: number; splice: (start: number, deleteCount?: number) => unknown[] }
}

function applyOverridesToModifiers(
  modifiers: Modifier[],
  overrides: ModifierOverrideMap,
  restores: (() => void)[]
): void {
  for (const raw of modifiers) {
    const m = raw as MutableModifier
    if (!m.slug || !(m.slug in overrides)) continue
    const want = overrides[m.slug]
    const origEnabled = m.enabled
    const origIgnored = m.ignored
    const origAdjustments = m.adjustments
    const hadOwnTest = Object.prototype.hasOwnProperty.call(m, 'test')
    const origTest = m.test
    // Snapshot the predicate contents and clear in place. We can't replace
    // the Predicate instance wholesale (PF2e holds it through inheritance
    // from Array<PredicateStatement>), but emptying the array reduces its
    // length to 0, which is what `Modifier.test()` short-circuits on.
    const origPredicateContents = (m.predicate as unknown as unknown[]).slice()
    restores.push(() => {
      m.enabled = origEnabled
      m.ignored = origIgnored
      m.adjustments = origAdjustments
      ;(m.predicate as unknown as unknown[]).push(...origPredicateContents)
      if (hadOwnTest) m.test = origTest
      else delete (m as { test?: unknown }).test
    })

    m.enabled = want
    m.ignored = !want
    // Shadow the prototype `test()` for any direct calls on this modifier
    // instance (some code paths run test() before the clone happens).
    m.test = () => {}
    // Wipe adjustments. PF2e's applyAdjustments() sets `ignored = true`
    // when any adjustment carries `suppress: true`, which is how a lot of
    // conditional/default-off modifiers stay disabled. Without this clear
    // our `ignored = false` gets clobbered inside calculateTotal.
    m.adjustments = []
    // CRITICAL for "enable": CheckModifier rebuilds every base modifier
    // via `m.clone()` (modifiers.ts:658), and the clone's constructor
    // builds a fresh Predicate from the source — so the clones run their
    // unshadowed prototype `test()` against the original predicate during
    // calculateTotal and re-derive `enabled` from it (line 326-331). The
    // override survives only if the cloned modifier sees an empty
    // predicate, so `test()` short-circuits on `predicate.length === 0`.
    m.predicate.splice(0, m.predicate.length)
  }
  // NOTE: PF2e's natural same-type stacking still runs here. If the user
  // manually enables multiple modifiers of the same non-untyped type, only
  // the highest-magnitude one will survive applyStackingRules; the others
  // get enabled=false during the roll. The StatBox UI mirrors this in its
  // modifier-list display (see stackingLoser()) so the user can see which
  // of their enables is the actual contributor.
}

// Shared clone-interception logic used by both withModifierOverrides and
// withRawModifierOverrides.
function wrapContextualClone(
  actor: ActorPF2e,
  getModifiers: (a: ActorPF2e) => Modifier[],
  overrides: ModifierOverrideMap,
  restores: (() => void)[]
): void {
  type CloneWrapper = { getContextualClone: (...args: unknown[]) => ActorPF2e }
  const hadOwnClone = Object.prototype.hasOwnProperty.call(actor, 'getContextualClone')
  const a = actor as unknown as CloneWrapper
  const origClone = a.getContextualClone
  a.getContextualClone = function (...args: unknown[]) {
    const clone = origClone.apply(this, args) as ActorPF2e
    const mods = getModifiers(clone)
    if (mods.length) applyOverridesToModifiers(mods, overrides, restores)
    return clone
  }
  restores.push(() => {
    if (hadOwnClone) a.getContextualClone = origClone
    else delete (a as { getContextualClone?: unknown }).getContextualClone
  })
}

// Override variant for Statistic-based checks (saves, skills, perception,
// initiative). Gets modifiers from statistic.check.modifiers.
export async function withModifierOverrides<T>(
  actor: ActorPF2e,
  getStatistic: (a: ActorPF2e) => Statistic | null | undefined,
  overrides: ModifierOverrideMap | undefined,
  doRoll: () => Promise<T>
): Promise<T> {
  if (!overrides || Object.keys(overrides).length === 0) return doRoll()

  const restores: (() => void)[] = []
  const getModifiers = (a: ActorPF2e): Modifier[] => getStatistic(a)?.check.modifiers ?? []

  applyOverridesToModifiers(getModifiers(actor), overrides, restores)
  wrapContextualClone(actor, getModifiers, overrides, restores)

  try {
    return await doRoll()
  } finally {
    for (const r of restores) r()
  }
}

// Override variant for strikes. Strikes are StatisticModifier instances
// (not wrapped in a Statistic), so we access their modifiers directly via a
// raw getter rather than through statistic.check.modifiers.
export async function withRawModifierOverrides<T>(
  actor: ActorPF2e,
  getModifiers: (a: ActorPF2e) => Modifier[],
  overrides: ModifierOverrideMap | undefined,
  doRoll: () => Promise<T>
): Promise<T> {
  if (!overrides || Object.keys(overrides).length === 0) return doRoll()

  const restores: (() => void)[] = []

  applyOverridesToModifiers(getModifiers(actor), overrides, restores)
  wrapContextualClone(actor, getModifiers, overrides, restores)

  try {
    return await doRoll()
  } finally {
    for (const r of restores) r()
  }
}
