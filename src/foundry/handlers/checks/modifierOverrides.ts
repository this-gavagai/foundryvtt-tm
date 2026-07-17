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
  applyAdjustments: (args: { rollOptions: Iterable<string> }) => void
  applyDamageAlterations?: (args: { item: unknown; test: string[] | Set<string> }) => void
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
    const origPredicateContents = (m.predicate as unknown[]).slice()
    restores.push(() => {
      m.enabled = origEnabled
      m.ignored = origIgnored
      m.adjustments = origAdjustments
      ;(m.predicate as unknown[]).push(...origPredicateContents)
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
    // via `m.clone()`, and the clone's constructor builds a fresh Predicate
    // from the source — so the clones run their unshadowed prototype
    // `test()` against the original predicate during calculateTotal and
    // re-derive `enabled` from it. The override survives only if the cloned
    // modifier sees an empty predicate, so `test()` short-circuits on
    // `predicate.length === 0`.
    m.predicate.splice(0, m.predicate.length)
  }
  // NOTE: PF2e's natural same-type stacking still runs here. If the user
  // manually enables multiple modifiers of the same non-untyped type, only
  // the highest-magnitude one will survive applyStackingRules; the others
  // get enabled=false during the roll. The StatBox UI mirrors this in its
  // modifier-list display (see stackingLoser()) so the user can see which
  // of their enables is the actual contributor.
}

// Shared clone-interception logic used by withRawModifierOverrides (and thus
// by withModifierOverrides, which delegates to it).
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

// Core override flow: apply the slug→enabled overrides to the modifiers
// reachable via getModifiers (on both the source actor and any contextual
// clone produced during the roll), run doRoll, then restore everything.
//
// Used directly for strikes, which are StatisticModifier instances (not
// wrapped in a Statistic) and so expose their modifiers via a raw getter
// rather than through statistic.check.modifiers.
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
    // LIFO: the same live Modifier can be captured twice (source actor +
    // a clone sharing statistic instances), and the second snapshot holds
    // the already-mutated state (empty predicate, adjustments: []). Forward
    // order would re-apply that mutated snapshot last, leaving the actor
    // permanently predicate-less until the next data prep.
    for (let i = restores.length - 1; i >= 0; i--) restores[i]()
  }
}

// Override variant for Statistic-based checks (saves, skills, perception,
// initiative). Resolves modifiers through statistic.check.modifiers, then
// defers to withRawModifierOverrides for the actual apply/restore flow.
export function withModifierOverrides<T>(
  actor: ActorPF2e,
  getStatistic: (a: ActorPF2e) => Statistic | null | undefined,
  overrides: ModifierOverrideMap | undefined,
  doRoll: () => Promise<T>
): Promise<T> {
  return withRawModifierOverrides(
    actor,
    (a) => getStatistic(a)?.check.modifiers ?? [],
    overrides,
    doRoll
  )
}

// Override variant for elemental blasts. Blasts can't use either of the flows
// above, because the statistic they actually roll never exists as a stable
// instance we can pre-mutate:
//
//   ElementalBlast.attack() takes the actor's cached "impulse" Statistic and
//   calls `statistic.extend({ check: { … } })` to build an *ephemeral* attack
//   statistic, re-extracting all synthetic modifiers for the blast domains.
//   The roll then reads that extended statistic's own `check.modifiers`
//   (statistic.ts roll(): `clonedStatistic?.check.modifiers ?? this.modifiers`).
//   The contextual-clone branch is unreachable for blasts — `extend` adds a
//   level to the statistic hierarchy, so RollContext#getClonedStatistic sees a
//   deviation and discards the clone — so neither the source-actor mutation nor
//   the getContextualClone wrapper used elsewhere can reach the rolled set.
//
// Instead we shadow `extend` on the live impulse statistic for the duration of
// the roll and apply the overrides to each extended statistic's check.modifiers
// as it's produced. CheckModifier later clones those when rolling, but the same
// empty-predicate trick documented in applyOverridesToModifiers keeps the
// override from being re-derived by the clones.
export async function withBlastModifierOverrides<T>(
  statistic: Statistic | null | undefined,
  overrides: ModifierOverrideMap | undefined,
  doRoll: () => Promise<T>
): Promise<T> {
  if (!statistic || !overrides || Object.keys(overrides).length === 0) return doRoll()

  type Extendable = { extend: (...args: unknown[]) => { check: { modifiers: Modifier[] } } }
  const s = statistic as unknown as Extendable
  const hadOwnExtend = Object.prototype.hasOwnProperty.call(statistic, 'extend')
  const origExtend = s.extend
  const restores: (() => void)[] = []

  s.extend = function (this: unknown, ...args: unknown[]) {
    const extended = origExtend.apply(this, args)
    // Accessing `.check` forces the (lazily built, then cached) StatisticCheck
    // to materialize now, so the instances we mutate are the very ones the
    // subsequent roll reads back off this statistic.
    applyOverridesToModifiers(extended.check.modifiers, overrides, restores)
    return extended
  }
  restores.push(() => {
    if (hadOwnExtend) s.extend = origExtend
    else delete (s as { extend?: unknown }).extend
  })

  try {
    return await doRoll()
  } finally {
    // LIFO for the same reason as withRawModifierOverrides: repeated extend()
    // calls can capture the same modifier twice, and only reverse-order
    // restore replays the clean snapshot last.
    for (let i = restores.length - 1; i >= 0; i--) restores[i]()
  }
}

const activeDamageOverrides: ModifierOverrideMap[] = []
// When a caller passes a `capture` Set to withDamageModifierOverrides, it is
// pushed here for the duration of the call. Every Modifier / DamageDicePF2e
// instance encountered in the hooked methods is added to the top-of-stack Set
// so the caller can read the full modifier list after the roll completes.
const activeCaptureArrays: Set<unknown>[] = []
let restoreDamagePrototypeOverrides: (() => void) | null = null

function currentDamageOverrides(): ModifierOverrideMap | undefined {
  return activeDamageOverrides[activeDamageOverrides.length - 1]
}

function applyDamageOverride(modifier: MutableModifier): void {
  const overrides = currentDamageOverrides()
  const slug = modifier.slug
  if (!overrides || !slug || !(slug in overrides)) return

  const want = overrides[slug]
  modifier.enabled = want
  modifier.ignored = !want
}

// DamageDicePF2e is not exported on game.pf2e, so we discover its prototype
// lazily from the first strike modifier list that includes dice instances.
// Once stored, installDamagePrototypeOverrides hooks applyAlterations on it so
// dice-based modifiers (sneak-attack precision dice, etc.) respect overrides
// for the duration of a damage roll, just like numeric Modifier instances do.
type MutableDamageDice = {
  slug: string
  enabled: boolean
  ignored: boolean
  applyAlterations: (args: { item: unknown; test: string[] | Set<string> }) => void
}

let damageDiceProto: MutableDamageDice | null = null
let restoreDamageDiceProto: (() => void) | null = null

// Call this with any mixed Modifier/DamageDicePF2e array (e.g. the
// options.damage.modifiers from a completed strike damage roll) to
// discover and cache the DamageDicePF2e prototype for future hook use.
// Safe to call repeatedly — it's a no-op once the prototype is known.
export function discoverDamageDicePrototype(modifiers: unknown[]): void {
  if (damageDiceProto) return
  // DamageDicePF2e instances have diceNumber (absent on Modifier) and applyAlterations.
  const diceInstance = modifiers.find(
    (m) =>
      m &&
      typeof m === 'object' &&
      'diceNumber' in (m as Record<string, unknown>) &&
      typeof (m as MutableDamageDice).applyAlterations === 'function'
  ) as MutableDamageDice | undefined
  if (!diceInstance) return
  const proto = Object.getPrototypeOf(diceInstance) as MutableDamageDice
  if (!proto?.applyAlterations) return
  damageDiceProto = proto
}

function installDamagePrototypeOverrides(): void {
  if (restoreDamagePrototypeOverrides) return

  const ModifierCtor = (
    globalThis as { game?: { pf2e?: { Modifier?: { prototype: MutableModifier } } } }
  ).game?.pf2e?.Modifier
  const proto = ModifierCtor?.prototype
  if (!proto) return

  const origTest = proto.test
  const origApplyAdjustments = proto.applyAdjustments
  const origApplyDamageAlterations = proto.applyDamageAlterations

  proto.test = function (this: MutableModifier, options: string[] | Set<string>) {
    origTest.call(this, options)
    applyDamageOverride(this)
    activeCaptureArrays[activeCaptureArrays.length - 1]?.add(this)
  }

  proto.applyAdjustments = function (
    this: MutableModifier,
    args: { rollOptions: Iterable<string> }
  ) {
    origApplyAdjustments.call(this, args)
    applyDamageOverride(this)
  }

  if (origApplyDamageAlterations) {
    proto.applyDamageAlterations = function (
      this: MutableModifier,
      args: { item: unknown; test: string[] | Set<string> }
    ) {
      origApplyDamageAlterations.call(this, args)
      applyDamageOverride(this)
      activeCaptureArrays[activeCaptureArrays.length - 1]?.add(this)
    }
  }

  // Hook DamageDicePF2e.prototype.applyAlterations if the prototype has been
  // discovered from a prior strike modifier list. WeaponDamagePF2e.calculate()
  // calls applyAlterations() on every die, making it a reliable hook point to
  // re-apply the requested enabled state after PF2e's alteration pass.
  // (Blast dice bypass this path, so blast dice overrides are not supported.)
  if (damageDiceProto && !restoreDamageDiceProto) {
    const diceProto = damageDiceProto
    const origDiceApplyAlterations = diceProto.applyAlterations
    diceProto.applyAlterations = function (
      this: MutableDamageDice,
      args: { item: unknown; test: string[] | Set<string> }
    ) {
      origDiceApplyAlterations.call(this, args)
      applyDamageOverride(this as unknown as MutableModifier)
      activeCaptureArrays[activeCaptureArrays.length - 1]?.add(this)
    }
    restoreDamageDiceProto = () => {
      diceProto.applyAlterations = origDiceApplyAlterations
      restoreDamageDiceProto = null
    }
  }

  restoreDamagePrototypeOverrides = () => {
    proto.test = origTest
    proto.applyAdjustments = origApplyAdjustments
    if (origApplyDamageAlterations) proto.applyDamageAlterations = origApplyDamageAlterations
    else delete (proto as { applyDamageAlterations?: unknown }).applyDamageAlterations
    restoreDamageDiceProto?.()
    restoreDamagePrototypeOverrides = null
  }
}

// Damage rolls differ from checks: PF2e creates fresh Modifier instances while
// building DamageFormulaData, and the native damage dialog toggles those fresh
// instances before the formula is finalized. Since Tablemate skips that dialog,
// temporarily shadow the Modifier prototype methods that PF2e calls during
// damage construction and re-apply the requested enabled state after predicate,
// adjustment, and damage-alteration passes.
//
// When `capture` is provided (a Set), every Modifier and DamageDicePF2e
// instance encountered in the hooked prototype methods is collected into it.
// Hooks are installed even when `overrides` is absent, so callers can use
// capture-only mode to extract a modifier list from damage paths that don't
// otherwise surface one (e.g. elemental blast formula calls).
export async function withDamageModifierOverrides<T>(
  overrides: ModifierOverrideMap | undefined,
  doRoll: () => Promise<T>,
  capture?: Set<unknown>
): Promise<T> {
  const hasOverrides = !!overrides && Object.keys(overrides).length > 0
  if (!hasOverrides && !capture) return doRoll()

  installDamagePrototypeOverrides()
  if (!restoreDamagePrototypeOverrides) return doRoll()

  if (hasOverrides) activeDamageOverrides.push(overrides!)
  if (capture) activeCaptureArrays.push(capture)
  try {
    return await doRoll()
  } finally {
    if (capture) activeCaptureArrays.pop()
    if (hasOverrides) activeDamageOverrides.pop()
    if (activeDamageOverrides.length === 0 && activeCaptureArrays.length === 0)
      restoreDamagePrototypeOverrides?.()
  }
}
