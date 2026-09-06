import { applyActiveEffectLikes } from './activeEffectLike'
import { applyStacking, collectFlatModifiers, type EngineItem, type EngineModifier } from './flatModifiers'
import { AC_DOMAINS, PERCEPTION_DOMAINS, SAVE_ATTRIBUTES, loreDomains, saveDomains, skillDomains } from './domains'
import { sealLedger, type Ledger, type SkippedRule } from './ledger'
import { buildRollOptions, type RollOptionSet } from './rollOptions'
import { stampMatchesVerifiedVersion } from './index'
import type { ValueContext } from './resolveValue'

// Tier 2: the figures that are reproducible from source ONCE rule elements are
// accounted for.
//
// Each is the same shape — a base the app can compute from stored data, plus
// whatever the engine can account for on top, plus a ledger saying what it
// could not. The base is where PF2e's arithmetic lives; the engine is where its
// content lives; the ledger is what makes the sum safe to show.
//
// The proficiency ranks are the reason ActiveEffectLike had to exist. A
// character's save and defence ranks are seeded from the CLASS ITEM's source
// fields and then raised by class features, each of which is an AE-like
// `upgrade` on `system.saves.<slug>.rank`. Skills are the exception: their ranks
// are stored on the actor, which is why skills were reachable before this.

// PF2e's 16 core skills and the attribute each keys off. A static table, and
// the reason a skill total needs no lookup into derived data.
export const SKILL_ATTRIBUTES: Record<string, string> = {
  acrobatics: 'dex',
  arcana: 'int',
  athletics: 'str',
  crafting: 'int',
  deception: 'cha',
  diplomacy: 'cha',
  intimidation: 'cha',
  medicine: 'wis',
  nature: 'wis',
  occultism: 'int',
  performance: 'cha',
  religion: 'wis',
  society: 'int',
  stealth: 'dex',
  survival: 'wis',
  thievery: 'dex'
}

// Rank → bonus. Untrained is zero under PF2e's default; the "untrained equals
// level" variant is a world setting this cannot see, so a world running it gets
// every untrained figure too low — recorded as a limitation rather than guessed.
export function proficiencyBonus(rank: number, level: number): number {
  return rank > 0 ? rank * 2 + level : 0
}

export interface DerivationInput {
  items: readonly EngineItem[]
  level: number
  // Proficiency ranks the actor already carries, keyed by the same paths PF2e
  // writes them to. The class item is a FLOOR, not the value — PF2e's own
  // `prepareActorData` does `Math.max(current, class.savingThrows[save])` — so
  // anything stored here has to go in first or a rank raised some other way is
  // silently overwritten downwards. Absent from the world dump for saves and
  // perception, which is exactly why the class floor is usually all there is.
  storedRanks?: Record<string, number>
  // Attribute modifiers, already computed from build data app-side.
  attributes: Record<string, number>
  traits?: readonly string[]
  activeRules?: readonly string[]
  stamp?: string
}

export interface DerivedStatistic {
  value: number
  base: number
  modifiers: EngineModifier[]
  ledger: Ledger
}

function contextFor(input: DerivationInput): ValueContext {
  const paths: Record<string, number> = { 'actor.level': input.level }
  for (const [attribute, modifier] of Object.entries(input.attributes)) {
    paths[`actor.abilities.${attribute}.mod`] = modifier
  }
  return { paths }
}

function optionsFor(input: DerivationInput, ranks: Record<string, number>): RollOptionSet {
  return buildRollOptions({
    level: input.level,
    traits: input.traits,
    items: input.items,
    // Rank options are what predicates like `self:save:fortitude:rank:3` read,
    // and they are only knowable once the ranks are resolved — which is why
    // ranks are computed first and fed back in here.
    activeRules: [
      ...(input.activeRules ?? []),
      ...Object.entries(ranks).map(([path, rank]) => `${path}:${rank}`)
    ]
  })
}

const classItem = (items: readonly EngineItem[]) => items.find((item) => item.type === 'class')

// Pull whatever proficiency ranks an actor's system already carries, keyed by
// the paths PF2e writes them to. Everything here is optional by design: a world
// dump routinely has none of it, which is the case the engine exists for.
export function readStoredRanks(system: unknown): Record<string, number> {
  const source = (system ?? {}) as {
    saves?: Record<string, { rank?: number } | undefined>
    skills?: Record<string, { rank?: number } | undefined>
    perception?: { rank?: number }
    proficiencies?: { defenses?: Record<string, { rank?: number } | undefined> }
  }
  const ranks: Record<string, number> = {}
  const put = (path: string, rank: unknown) => {
    if (typeof rank === 'number') ranks[path] = rank
  }
  for (const [slug, save] of Object.entries(source.saves ?? {})) put(`system.saves.${slug}.rank`, save?.rank)
  for (const [slug, skill] of Object.entries(source.skills ?? {})) put(`system.skills.${slug}.rank`, skill?.rank)
  put('system.perception.rank', source.perception?.rank)
  for (const [slug, defense] of Object.entries(source.proficiencies?.defenses ?? {})) {
    put(`system.proficiencies.defenses.${slug}.rank`, defense?.rank)
  }
  return ranks
}

interface ClassSystem {
  savingThrows?: Record<string, number>
  defenses?: Record<string, number>
  perception?: number
  hp?: number
  trainedSkills?: { value?: string[] }
}

// Every proficiency rank the Tier-2 figures need, in one pass.
//
// Seeded from the class item's stored ranks, then handed to the AE-like applier
// so class features can raise them. Computed together rather than per figure
// because the AE-like pass is priority-ordered across the whole actor: resolving
// one path at a time would apply the same rules repeatedly and, where a rule
// touches two paths, in inconsistent order.
export function deriveProficiencyRanks(input: DerivationInput): {
  ranks: Record<string, number>
  skipped: SkippedRule[]
  applied: number
} {
  const klass = classItem(input.items)?.system as ClassSystem | undefined
  const stored = input.storedRanks ?? {}
  const seed: Record<string, number> = {}
  // The class is a floor over whatever the actor already has, never a
  // replacement for it. Getting this backwards read a Kineticist's expert Will
  // as trained and put the save two points low, with nothing recorded — the
  // class had said 1 and that overwrote the 2 already there.
  const floor = (path: string, classValue: number | undefined) => {
    seed[path] = Math.max(stored[path] ?? 0, classValue ?? 0)
  }

  for (const save of Object.keys(SAVE_ATTRIBUTES)) {
    floor(`system.saves.${save}.rank`, klass?.savingThrows?.[save])
  }
  for (const category of ['unarmored', 'light', 'medium', 'heavy']) {
    floor(`system.proficiencies.defenses.${category}.rank`, klass?.defenses?.[category])
  }
  floor('system.perception.rank', klass?.perception)
  floor('system.proficiencies.classDCs.rank', klass ? 1 : 0)

  // Skills are seeded too, and from the same two sources. They were left out
  // originally on the belief that their ranks are always stored on the actor —
  // true of a prepared payload, but the WORLD DUMP carried ranks for only four
  // of one character's eight trained skills. The rest arrive as AE-like
  // upgrades from feats and class features, which cannot land on a path that
  // was never seeded.
  for (const slug of Object.keys(SKILL_ATTRIBUTES)) {
    floor(`system.skills.${slug}.rank`, klass?.trainedSkills?.value?.includes(slug) ? 1 : 0)
  }
  for (const path of Object.keys(stored)) {
    if (!(path in seed)) seed[path] = stored[path]
  }
  const context = contextFor(input)
  const bootstrap = buildRollOptions({
    level: input.level,
    traits: input.traits,
    items: input.items,
    activeRules: input.activeRules
  })
  const result = applyActiveEffectLikes(input.items, seed, bootstrap, context)

  // Saves and perception whose rank rests on the class baseline alone. A world
  // dump carries no `system.saves` at all, so this is the normal case there —
  // and a class feature that raises the rank in PF2e's own code leaves no trace
  // for the engine to follow. Reported per path so a figure can decide whether
  // the gap is one of ITS inputs.
  const unconfirmed: SkippedRule[] = []
  for (const path of [...Object.keys(SAVE_ATTRIBUTES).map((s) => `system.saves.${s}.rank`), 'system.perception.rank']) {
    if (path in stored) continue
    // A rule element that actually moved this rank is positive evidence, and a
    // far more common way for a class feature to grant expertise than the
    // rules-free kind. Marking those too would flag most characters for a case
    // that did not apply to them.
    if (result.paths[path] !== seed[path]) continue
    unconfirmed.push({
      reason: 'unconfirmable-rank',
      key: 'ProficiencyRank',
      slug: path,
      detail: 'class baseline only; a rules-free class feature could raise it'
    })
  }
  return {
    ranks: result.paths,
    skipped: [...result.skipped, ...unconfirmed],
    applied: result.applied
  }
}

// The attribute and proficiency components of a statistic, as TYPED MODIFIERS
// rather than a flat base.
//
// This is not presentation — it is what makes stacking correct. PF2e builds both
// with `createAttributeModifier` / `createProficiencyModifier` and lets them
// contest anything of the same type. Untrained Improvisation is a
// `proficiency`-typed modifier, so on a TRAINED skill it loses to the real
// proficiency bonus and contributes nothing.
//
// Held outside the contest, the base had no competitor, and Untrained
// Improvisation stacked on top of every trained skill — every one of a live
// character's eight read four points high. Its own modifier list shows PF2e's
// answer plainly: `proficiency:0:proficiency:false` beside
// `untrained-improvisation:4:proficiency:true` on an untrained skill, and the
// reverse once trained.
function baseModifiers(attributeSlug: string, attribute: number, proficiency: number): EngineModifier[] {
  const make = (slug: string, modifier: number, type: string): EngineModifier => ({
    slug,
    label: slug,
    modifier,
    type,
    enabled: true,
    hideIfDisabled: false,
    force: false,
    source: ''
  })
  return [make(attributeSlug, attribute, 'ability'), make('proficiency', proficiency, 'proficiency')]
}

// A figure inherits only the rank gaps that belong to it. Carrying every
// unconfirmed rank into every statistic would mark a skill provisional because a
// save's rank was uncertain, which is both false and the fastest way to teach a
// reader to ignore the marker.
function relevant(carried: { applied: number; skipped: SkippedRule[] }, paths: string[]) {
  return {
    applied: carried.applied,
    skipped: carried.skipped.filter(
      (skip) => skip.reason !== 'unconfirmable-rank' || paths.includes(skip.slug ?? '')
    )
  }
}

function build(
  input: DerivationInput,
  // A constant that takes part in no contest — AC's 10, an armour's own AC
  // bonus. Everything that CAN contest arrives through `seedModifiers`.
  constant: number,
  seedModifiers: EngineModifier[],
  domains: readonly string[],
  ranks: Record<string, number>,
  carried: { applied: number; skipped: SkippedRule[] }
): DerivedStatistic {
  const options = optionsFor(input, ranks)
  const collected = collectFlatModifiers(input.items, domains, options, contextFor(input))
  const all = [...seedModifiers, ...collected.modifiers]
  return {
    base: constant + applyStacking(seedModifiers),
    value: constant + applyStacking(all),
    modifiers: all,
    ledger: sealLedger(
      {
        applied: carried.applied + collected.applied,
        skipped: [...carried.skipped, ...collected.skipped]
      },
      stampMatchesVerifiedVersion(input.stamp)
    )
  }
}

// ── The figures ────────────────────────────────────────────────────────────

export function deriveSkill(
  input: DerivationInput,
  slug: string,
  storedRank: number,
  options: { lore?: boolean; attribute?: string } = {}
): DerivedStatistic {
  const { ranks, ...carried } = deriveProficiencyRanks(input)
  const attribute = options.lore ? 'int' : (options.attribute ?? SKILL_ATTRIBUTES[slug] ?? 'int')
  // The resolved rank wins over the caller's: it already folds the caller's in
  // as a floor, and it also carries any AE-like upgrade the caller cannot see.
  const rank = Math.max(ranks[`system.skills.${slug}.rank`] ?? 0, storedRank)
  const domains = options.lore ? loreDomains(slug) : skillDomains(slug, attribute)
  return build(
    input,
    0,
    baseModifiers(attribute, input.attributes[attribute] ?? 0, proficiencyBonus(rank, input.level)),
    domains,
    ranks,
    relevant(carried, [])
  )
}

export function deriveSave(input: DerivationInput, slug: string): DerivedStatistic {
  const { ranks, ...carried } = deriveProficiencyRanks(input)
  const attribute = SAVE_ATTRIBUTES[slug] ?? 'con'
  const rank = ranks[`system.saves.${slug}.rank`] ?? 0
  return build(
    input,
    0,
    baseModifiers(attribute, input.attributes[attribute] ?? 0, proficiencyBonus(rank, input.level)),
    saveDomains(slug, attribute),
    ranks,
    relevant(carried, [`system.saves.${slug}.rank`])
  )
}

export function derivePerception(input: DerivationInput): DerivedStatistic {
  const { ranks, ...carried } = deriveProficiencyRanks(input)
  const rank = ranks['system.perception.rank'] ?? 0
  return build(
    input,
    0,
    baseModifiers('wis', input.attributes.wis ?? 0, proficiencyBonus(rank, input.level)),
    PERCEPTION_DOMAINS,
    ranks,
    relevant(carried, ['system.perception.rank'])
  )
}

interface ArmorSystem {
  category?: string
  acBonus?: number
  dexCap?: number | null
  runes?: { potency?: number }
  equipped?: { carryType?: string; inSlot?: boolean }
}

// The worn armour, by PF2e's own test: equipped in its slot. Unarmoured is the
// absence of one, and carries its own proficiency category.
function wornArmor(items: readonly EngineItem[]) {
  return items.find((item) => {
    if (item.type !== 'armor') return false
    const system = item.system as unknown as ArmorSystem
    return system.equipped?.carryType === 'worn' && system.equipped?.inSlot !== false
  })
}

export function deriveArmorClass(input: DerivationInput): DerivedStatistic {
  const { ranks, ...carried } = deriveProficiencyRanks(input)
  const armor = wornArmor(input.items)
  const system = armor?.system as unknown as ArmorSystem | undefined
  const category = system?.category ?? 'unarmored'
  const rank = ranks[`system.proficiencies.defenses.${category}.rank`] ?? 0
  // Dex is capped by the armour, which is the one place AC's arithmetic differs
  // in shape from a check's.
  const dexCap = typeof system?.dexCap === 'number' ? system.dexCap : Infinity
  const dex = Math.min(input.attributes.dex ?? 0, dexCap)
  // 10 and the armour's own AC bonus contest nothing; dex and proficiency do.
  // The potency rune is an `item` bonus and belongs in the contest with any
  // other item bonus to AC.
  const potency = system?.runes?.potency ?? 0
  const seeds = baseModifiers('dex', dex, proficiencyBonus(rank, input.level))
  if (potency) {
    seeds.push({
      slug: 'armor-potency',
      label: 'armor-potency',
      modifier: potency,
      type: 'item',
      enabled: true,
      hideIfDisabled: false,
      force: false,
      source: ''
    })
  }
  return build(input, 10 + (system?.acBonus ?? 0), seeds, AC_DOMAINS, ranks, relevant(carried, []))
}

export function deriveClassDC(input: DerivationInput, keyAttribute: string): DerivedStatistic {
  const { ranks, ...carried } = deriveProficiencyRanks(input)
  const rank = ranks['system.proficiencies.classDCs.rank'] ?? 0
  return build(
    input,
    10,
    baseModifiers(keyAttribute, input.attributes[keyAttribute] ?? 0, proficiencyBonus(rank, input.level)),
    ['class-dc', 'all'],
    ranks,
    relevant(carried, [])
  )
}

interface AncestrySystem {
  hp?: number
}

// Maximum hit points.
//
//   ancestry HP + (class HP + Con + bonus per level) x level
//
// Every input is stored. The rule elements that reach it are FlatModifiers on
// the `hp` domain — Toughness among them, which adds the character's LEVEL
// rather than a flat number and so resolves through @actor.level.
export function deriveHitPointsMax(input: DerivationInput, bonusPerLevel = 0): DerivedStatistic {
  const { ranks, ...carried } = deriveProficiencyRanks(input)
  const ancestry = input.items.find((item) => item.type === 'ancestry')?.system as
    | AncestrySystem
    | undefined
  const klass = classItem(input.items)?.system as ClassSystem | undefined
  const perLevel = (klass?.hp ?? 0) + (input.attributes.con ?? 0) + bonusPerLevel
  // Hit points have no proficiency or attribute modifier of their own — the Con
  // contribution is already multiplied by level inside the total.
  return build(
    input,
    (ancestry?.hp ?? 0) + perLevel * input.level,
    [],
    ['hp', 'con-based'],
    ranks,
    relevant(carried, [])
  )
}
