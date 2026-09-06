// The roll options the engine is prepared to answer questions about.
//
// This is a CLOSED set, and that is the whole design. PF2e's own option set is
// seeded from prepared state — `self:armored`, `self:effect:*`, weapon and
// target options built during a roll — so an app working from source data can
// never reproduce all of it. The temptation is to build as many as possible and
// treat the rest as absent.
//
// Absent must not mean false. A predicate reading `not:self:armored` is TRUE
// when the option is genuinely missing and UNKNOWABLE when the engine simply
// cannot see it, and those two produce different numbers. Collapsing them is
// exactly how a figure ends up silently wrong while looking indistinguishable
// from a right one.
//
// So membership is declared, not accumulated: `KNOWN_PREFIXES` says which
// families the engine claims to know completely. An option inside a known family
// is present-or-absent as the set says. An option outside every known family is
// unresolvable, and the predicate evaluator refuses rather than guessing.

export interface RollOptionSource {
  level?: number
  // Ancestry/heritage/class/background slugs and the actor's traits.
  traits?: readonly string[]
  // Every item on the actor, as source data.
  items?: readonly {
    type?: string
    name?: string
    system?: {
      slug?: string | null
      rules?: unknown[]
      traits?: { value?: string[] }
      equipped?: { carryType?: string; handsHeld?: number; invested?: boolean | null }
    }
  }[]
  // RollOption rule elements the GM reported as currently active. The app has
  // carried this for years precisely because it cannot evaluate predicates
  // itself; where it is available it is authoritative and folded straight in.
  activeRules?: readonly string[]
}

// The families this engine claims to know completely. Anything matching one of
// these is answerable — present in the set, or genuinely absent. Anything else
// is not this engine's to judge.
//
// Kept short on purpose. Every entry here is a promise that the builder below
// enumerates that family exhaustively from source data, and a family added
// without that work turns "I don't know" back into a silent "no".
const KNOWN_PREFIXES = [
  'self:level',
  'self:trait',
  'self:effect',
  'self:condition',
  'item:slug',
  'self:item'
] as const

// Families that are knowably ABSENT from a statistic computed at rest.
//
// This is the difference between "I cannot see it" and "it is not there", and it
// was the single largest source of unresolvable predicates on a live world — 35
// of the atoms appearing in one table's FlatModifier predicates.
//
// A sheet figure is the value with no target selected and no action declared, so
// nothing can have put `action:aid` or `target:trait:undead` into the option set.
// PF2e agrees, visibly: it lists Cooperative Nature — predicate `["action:aid"]`
// — in a skill's modifiers with `enabled: false`, and the modifier contributes
// nothing to the reported total.
//
// The direction matters both ways, and both are faithful. A bare
// `action:aid` is false at rest, so its modifier is dropped; a negated
// `{not: "target:trait:undead"}` is TRUE at rest, so its modifier applies —
// which is exactly what PF2e does against its own empty set.
//
// Deliberately NOT here: `item:trait` and bare situational slugs like
// `lit-torch`. Those may be properties of an item genuinely in play rather than
// of a roll being made, and guessing them absent would be the silent-false
// mistake this whole set exists to avoid.
const ABSENT_AT_REST = ['action', 'self:action', 'target', 'origin'] as const

export interface RollOptionSet {
  has: (option: string) => boolean
  // Whether the engine is entitled to an opinion about this option at all.
  knows: (option: string) => boolean
}

const CONDITION_TYPES = new Set(['condition'])
const EFFECT_TYPES = new Set(['effect', 'affliction'])

export function buildRollOptions(source: RollOptionSource): RollOptionSet {
  const options = new Set<string>()

  if (typeof source.level === 'number') {
    options.add(`self:level:${source.level}`)
  }
  for (const trait of source.traits ?? []) options.add(`self:trait:${trait}`)

  for (const item of source.items ?? []) {
    const slug = item.system?.slug ?? undefined
    if (slug) {
      options.add(`item:slug:${slug}`)
      options.add(`self:item:${slug}`)
      if (CONDITION_TYPES.has(item.type ?? '')) options.add(`self:condition:${slug}`)
      if (EFFECT_TYPES.has(item.type ?? '')) options.add(`self:effect:${slug}`)
    }
  }

  // `activeRules` says which RollOption rules' PREDICATES pass — it is built
  // Foundry-side as `if (rule.option && rule.predicate.test([]))`, and says
  // nothing about whether the option is actually set. The app's own roll-options
  // panel has always read it that way: the list decides which toggles to SHOW,
  // and each rule's `value` decides whether it is on.
  //
  // Treating membership as "the option is present" switched on every toggleable
  // option a character had. One live character's Ageless Patience — +2 to
  // perception and every skill, behind a toggle she has never flipped — was
  // applied to all seventeen figures.
  //
  // PF2e's own schema settles the default: `value` is a ResolvableValueField
  // with `initial: (data) => !data.toggleable`. A non-toggleable rule with no
  // value is ON; a TOGGLEABLE one with no value is OFF.
  const reported = new Set(source.activeRules ?? [])
  const undecidable = new Set<string>()
  // An option the GM adjudicated but whose rule is not among the items we were
  // given — granted by something we cannot see — has no discoverable toggle
  // state. Undecidable rather than off: "the GM says this rule applies" is not
  // evidence that it is switched off.
  const located = new Set<string>()
  for (const item of source.items ?? []) {
    for (const raw of item.system?.rules ?? []) {
      const rule = raw as { key?: string; option?: string; toggleable?: unknown; value?: unknown }
      if (rule.key !== 'RollOption' || typeof rule.option !== 'string') continue
      if (!reported.has(rule.option)) continue
      located.add(rule.option)
      const value = rule.value ?? !rule.toggleable
      if (typeof value !== 'boolean') {
        // A formula-valued toggle. Resolvable in principle, but not from here,
        // and guessing either way sets or clears a real modifier.
        undecidable.add(rule.option)
        continue
      }
      if (value) options.add(rule.option)
    }
  }
  for (const option of reported) {
    if (!located.has(option)) undecidable.add(option)
  }

  const atRest = (option: string) =>
    ABSENT_AT_REST.some((prefix) => option === prefix || option.startsWith(`${prefix}:`))

  return {
    // An at-rest family is answerable and the answer is no — unless the GM has
    // actually reported the option, which outranks the assumption.
    has: (option) => options.has(option),
    knows: (option) =>
      !undecidable.has(option) &&
      (reported.has(option) ||
        atRest(option) ||
        KNOWN_PREFIXES.some((prefix) => option.startsWith(`${prefix}:`)))
  }
}

// An option set that knows nothing. Every predicate against it is unresolvable,
// so an engine handed this contributes no modifiers and skips everything —
// which is the correct behaviour for an actor the app has no data for, and a
// useful default in tests.
export function emptyRollOptions(): RollOptionSet {
  return { has: () => false, knows: () => false }
}
