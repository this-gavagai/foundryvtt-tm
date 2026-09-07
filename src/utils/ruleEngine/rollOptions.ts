// The roll options the engine is prepared to answer questions about.
//
// A CLOSED set, and that is the design. PF2e seeds its own option set from
// prepared state, so an app working from source data can never reproduce all of
// it — and absent must not mean false. `not:self:armored` is TRUE when the
// option is genuinely missing and UNKNOWABLE when the engine cannot see it, and
// those produce different numbers.
//
// So membership is DECLARED, not accumulated: `KNOWN_PREFIXES` names the
// families the engine claims to enumerate exhaustively. Adding one without
// doing that work turns "I don't know" back into a silent "no".
//
// See ../README.md for the three atom kinds and how each is answered.

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
  // PF2e's OWN option set for this actor at rest — the GM's
  // `actor.getRollOptions()`, sent whole. The authority where it is present:
  // the toggle-state guessing below stands down, because an option PF2e lists
  // is on and one it does not list is off.
  //
  // It does NOT make every atom answerable. It describes the actor at the moment
  // the payload was built, and a local write since then could have moved
  // anything — so presence is what the GM settles, and the taxonomy is not.
  rollOptionSet?: readonly string[]
  // The actor's resolved proficiency ranks, as PF2e's own option strings:
  // `save:fortitude:rank:2`, `skill:athletics:rank:1`, `perception:rank:3`,
  // `defense:heavy:rank:1`, `attack:martial:rank:2`.
  //
  // Naming the FAMILY matters as much as the value: a predicate can ask
  // `{gte: ["save:fortitude:rank", 2]}`, which needs `knows` to answer for the
  // whole `save:fortitude:rank:<n>` family and not only the value present.
  rankOptions?: readonly string[]
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

// ROLL CONTEXT: options only an actual roll can introduce.
//
// A displayed statistic is the value with no action declared, no target chosen
// and no item in hand, so nothing can have put `action:aid` or
// `target:trait:undead` into the set — those are ABSENT rather than unresolved,
// and a modifier gated on one is CONDITIONAL. PF2e agrees structurally:
// `ModifierPF2e` defaults `enabled` to `predicate.test([])`, and
// `Statistic#createRollOptions` takes item, origin and target as CALL
// parameters, which a displayed statistic passes none of.
//
// `item:` is here ONLY because this engine derives no strikes. For a strike PF2e
// passes the weapon and `item:trait:agile` is a fact about a real thing in hand.
// ADDING STRIKE DERIVATION MEANS REVISITING THIS LINE — the classification would
// have to become domain-aware rather than global.
const CONTEXT_PREFIXES = ['action', 'self:action', 'target', 'origin', 'item'] as const

// Options whose ONLY producer is a RollOption rule element.
//
// Individual options PF2e defines as extension hooks and never sets itself.
// `armor:ignore-speed-penalty` occurs exactly once in the system's 5.8MB bundle
// — inside the predicate that reads it — and in none of the shipped compendium
// packs; the same is true of `self:shield:ignore-speed-penalty`. That is what
// makes them answerable, and an entry added here without confirming no code path
// and no content sets it turns "I don't know" into a silent "no" — for these
// two, quietly dropping an armour speed penalty.
//
// Decided by the rules scan below like any other option, so a character who
// really carries such a toggle still gets the honest answer.
const RULE_DECLARED_ONLY = [
  'armor:ignore-speed-penalty',
  'self:shield:ignore-speed-penalty'
] as const

// Where an option comes from, which decides whether "absent" is an answer or an
// admission.
//
//   'base'     persistent actor state the engine enumerates, or that PF2e
//              itself reported. Present-or-absent is a real answer.
//   'context'  supplied by a roll that has not happened. Absent by definition
//              rather than by ignorance, so a modifier gated on one is
//              CONDITIONAL.
//   'opaque'   could be base state and the engine cannot tell. The only honest
//              unknown, and the only one that costs a figure its confidence.
export type AtomKind = 'base' | 'context' | 'opaque'

export interface RollOptionSet {
  has: (option: string) => boolean
  // Whether the engine is entitled to an opinion about this option at all.
  knows: (option: string) => boolean
  kindOf: (option: string) => AtomKind
}

// The option set re-asked with CONTEXT atoms withheld.
//
// The set's own `knows` already answers as PF2e answers, and that verdict decides
// the NUMBER. This one decides nothing about it: it separates "false because the
// roll has not happened" from "false because this character can never trigger
// it" — the difference between a modifier worth showing as "+2 vs traps" and one
// worth hiding. See ConditionalModifier, and the disabled rows in
// ModifierOverrideList that render it.
//
// There is deliberately no `asRolled` counterpart. There was one, at fourteen
// call sites, rebuilding `knows` as `kindOf(o) !== 'opaque'` — which is exactly
// what `buildRollOptions` returns, so it was a no-op on every set ever built.
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

  // THE AUTHORITY, WHERE THERE IS ONE.
  //
  // A GM who has answered for this actor sent PF2e's own option set, so every
  // question below it is already settled: which toggles are flipped, which
  // effects and conditions are on, whether the character is armoured. The
  // inference that follows exists for the payload that carries no such set — an
  // older module, or no GM at all — and is skipped entirely when one arrives.
  const authoritative = new Set(source.rollOptionSet ?? [])
  for (const option of authoritative) options.add(option)

  // `activeRules` says which RollOption rules' PREDICATES pass, and says nothing
  // about whether the option is SET — which is why membership here must not be
  // read as presence. The roll-options panel reads it the same way: the list
  // decides which toggles to SHOW, and the value decides whether one is on.
  //
  // PF2e's schema settles the default: `value` is a ResolvableValueField with
  // `initial: (data) => !data.toggleable`. A non-toggleable rule with no value
  // is ON; a TOGGLEABLE one with no value is OFF.
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
      // PF2e already told us whether this one is set. Guessing on top of the
      // answer can only make it worse.
      if (authoritative.size > 0) continue
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
    if (authoritative.size > 0) break
    if (!located.has(option)) undecidable.add(option)
  }

  // Rank options, and the families they belong to. The family is what makes a
  // numeric comparison answerable: `knows('save:fortitude:rank:0')` has to be
  // true for a `gte` to resolve, whatever the actual rank turns out to be.
  const rankKeys = new Set<string>()
  for (const option of source.rankOptions ?? []) {
    options.add(option)
    const key = option.replace(/:\d+$/, '')
    if (key !== option) rankKeys.add(key)
  }

  const isContext = (option: string) =>
    CONTEXT_PREFIXES.some((prefix) => option === prefix || option.startsWith(`${prefix}:`))
  const traitNames = new Set(source.traitVocabulary ?? [])

  const kindOf = (option: string): AtomKind => {
    // An option whose toggle state we could not settle is opaque whatever else
    // it looks like: we know it EXISTS, which is exactly why we cannot call it
    // absent.
    if (undecidable.has(option)) return 'opaque'
    // PF2e's own set outranks everything: it enumerated this option, so its
    // presence or absence is a fact rather than a reading.
    if (authoritative.has(option)) return 'base'
    // The GM's own adjudication outranks every inference below it.
    if (reported.has(option)) return 'base'
    // A rank the engine resolved. Answerable across the whole family, so an
    // absent value is a real "no" rather than an admission — which is the
    // point of enumerating them.
    if (rankKeys.has(option.replace(/:\d+$/, ''))) return 'base'
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

// An option set that knows nothing: every predicate against it is unresolvable,
// so the engine contributes no modifiers and skips everything. Correct for an
// actor the app has no data for, and the default in tests.
export function emptyRollOptions(): RollOptionSet {
  return { has: () => false, knows: () => false, kindOf: () => 'opaque' }
}
