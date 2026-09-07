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
  // Every trait slug PF2e defines, from the world's published trait catalog.
  //
  // Needed because a bare atom carries no marker of where it comes from.
  // `emotion` and `trap` are the traits of the effect being rolled against, put
  // into the set by the roll; `ageless-patience` and `trap-finder` are toggles
  // declared by rule elements. The strings look identical, and the trait
  // vocabulary is the only thing that tells them apart.
  //
  // Absent, every bare atom stays opaque — the conservative reading, and the
  // same posture the item-name catalog takes when it has not been published.
  traitVocabulary?: readonly string[]
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

// ROLL CONTEXT: options that only an actual roll can introduce.
//
// The distinction this set draws is not "can I see it" but "is there anything to
// see YET", and they are different questions with different right answers.
//
// A displayed statistic is the value with no action declared, no target chosen
// and no item in hand. Nothing can have put `action:aid` or `target:trait:undead`
// into the option set, so those are not unresolved — they are ABSENT, and a
// modifier gated on one is CONDITIONAL rather than unknown. PF2e agrees
// structurally: `ModifierPF2e`'s constructor defaults `enabled` to
// `predicate.test([])`, and `Statistic#createRollOptions` takes the item, origin
// and target as CALL PARAMETERS — a statistic being displayed passes none of
// them. It then keeps the failing modifier in its list with `enabled: false`
// rather than treating it as a gap.
//
// The direction matters both ways, and both are faithful. A bare `action:aid` is
// false, so its modifier does not apply; a negated `{not: "target:trait:undead"}`
// is TRUE, so its modifier does — which is exactly what PF2e computes against
// its own empty set.
//
// `item:` IS here, and that is only true because this engine derives no strikes.
// For a strike PF2e passes the weapon, and `item:trait:agile` is then a fact
// about a real thing in hand. For AC, a save, a skill or perception it passes no
// item at all. ADDING STRIKE DERIVATION MEANS REVISITING THIS LINE — the
// classification would have to become domain-aware rather than global.
const CONTEXT_PREFIXES = ['action', 'self:action', 'target', 'origin', 'item'] as const

// Options whose ONLY producer is a RollOption rule element.
//
// A third kind of knowledge, and the narrowest. These are not families and not
// at-rest assumptions: they are individual options that PF2e defines as
// extension hooks and never sets itself. `armor:ignore-speed-penalty` occurs
// exactly once in the system's 5.8MB bundle — inside the predicate that reads
// it — and in none of the shipped compendium packs; the same is true of
// `self:shield:ignore-speed-penalty`. Nothing but a RollOption rule element, on
// an item this engine can see, can put either into the option set.
//
// That is what makes them answerable, and the entry is only as good as the
// checking behind it. Adding an option here without confirming that no code path
// and no content sets it turns "I don't know" back into a silent "no" — which
// for these two would mean quietly dropping an armour speed penalty, in the
// flattering direction.
//
// Left OUT of the loop below on purpose: they are decided by the rules scan
// like any other option, so a character who really does carry such a toggle
// still gets the honest answer.
const RULE_DECLARED_ONLY = [
  'armor:ignore-speed-penalty',
  'self:shield:ignore-speed-penalty'
] as const

// Where an option comes from, which is what decides whether "absent" is an
// answer or an admission.
//
//   'base'     persistent actor state — level, traits, items, conditions,
//              effects, and RollOption toggles in their default position. The
//              engine enumerates these, so present-or-absent is a real answer.
//   'context'  supplied by a roll that has not happened. Absent by definition
//              rather than by ignorance, so a modifier gated on one is
//              CONDITIONAL: it contributes nothing now and would contribute
//              under the right roll.
//   'opaque'   could be base state, and the engine cannot tell. The only honest
//              unknown, and the only one that should cost a figure its
//              confidence.
export type AtomKind = 'base' | 'context' | 'opaque'

export interface RollOptionSet {
  has: (option: string) => boolean
  // Whether the engine is entitled to an opinion about this option at all.
  knows: (option: string) => boolean
  kindOf: (option: string) => AtomKind
}

// Two readings of one option set, which is the whole mechanism.
//
// The predicate evaluator is already three-valued; it does not need to learn
// about context. It just needs to be asked twice, against a set that answers
// differently:
//
//   asRolled       context atoms are ANSWERABLE and absent. This reproduces
//                  PF2e exactly, and its verdict is the one that decides the
//                  number.
//   asPersistent   context atoms are UNKNOWN. This decides nothing about the
//                  number; it separates "false because the roll has not
//                  happened" from "false because this character can never
//                  trigger it", which is the difference between a modifier
//                  worth showing as "+2 vs traps" and one worth hiding.
export function asRolled(options: RollOptionSet): RollOptionSet {
  return {
    has: options.has,
    knows: (option) => options.kindOf(option) !== 'opaque',
    kindOf: options.kindOf
  }
}

export function asPersistent(options: RollOptionSet): RollOptionSet {
  return {
    has: options.has,
    knows: (option) => options.kindOf(option) === 'base',
    kindOf: options.kindOf
  }
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

  const isContext = (option: string) =>
    CONTEXT_PREFIXES.some((prefix) => option === prefix || option.startsWith(`${prefix}:`))
  const traitNames = new Set(source.traitVocabulary ?? [])

  const kindOf = (option: string): AtomKind => {
    // An option whose toggle state we could not settle is opaque whatever else
    // it looks like: we know it EXISTS, which is exactly why we cannot call it
    // absent.
    if (undecidable.has(option)) return 'opaque'
    // The GM's own adjudication outranks every inference below it.
    if (reported.has(option)) return 'base'
    if (KNOWN_PREFIXES.some((prefix) => option.startsWith(`${prefix}:`))) return 'base'
    if (RULE_DECLARED_ONLY.includes(option as (typeof RULE_DECLARED_ONLY)[number])) return 'base'
    if (isContext(option)) return 'context'
    // A bare atom naming a PF2e trait is one of the ROLL's traits — what you are
    // rolling against, not what you are.
    if (traitNames.has(option)) return 'context'
    return 'opaque'
  }

  return {
    has: (option) => options.has(option),
    // The union of the two answerable kinds, which is what the evaluator wants
    // when it is asked for PF2e's own verdict.
    knows: (option) => kindOf(option) !== 'opaque',
    kindOf
  }
}

// An option set that knows nothing. Every predicate against it is unresolvable,
// so an engine handed this contributes no modifiers and skips everything —
// which is the correct behaviour for an actor the app has no data for, and a
// useful default in tests.
export function emptyRollOptions(): RollOptionSet {
  return { has: () => false, knows: () => false, kindOf: () => 'opaque' }
}
