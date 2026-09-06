import { applyActiveEffectLikes } from './activeEffectLike'
import {
  applyStacking,
  collectFlatModifiers,
  resolveStacking,
  type EngineItem,
  type EngineModifier
} from './flatModifiers'
import {
  AC_DOMAINS,
  PERCEPTION_DOMAINS,
  SAVE_ATTRIBUTES,
  loreDomains,
  saveDomains,
  skillDomains
} from './domains'
import { sealLedger, type Ledger, type SkippedRule } from './ledger'
import { buildRollOptions, type RollOptionSet } from './rollOptions'
import { versionVerdict } from './index'
import type { ValueContext } from './resolveValue'
import { deriveSpeeds, type DerivedSpeed, type MovementType } from './movement'
import { deriveIWR as deriveIWRSets, type DerivedIWR } from './iwr'

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

const WEAPON_CATEGORIES = ['unarmed', 'simple', 'martial', 'advanced']
const ARMOR_CATEGORIES = ['unarmored', 'light', 'medium', 'heavy', 'light-barding', 'heavy-barding']

// Where a feat's `system.subfeatures.proficiencies` entry writes to.
//
// This is the mechanism that made save and armour ranks look unrecoverable. A
// class feature like "Reflex Expertise" has an EMPTY rules array — there is no
// rule element to find — but it carries
// `subfeatures.proficiencies.reflex = { rank: 2 }` as plain stored data, and
// PF2e's `FeatPF2e#prepareActorData` folds it in with Math.max. Every character
// on a live table had at least one, and reading the rules alone saw none of them.
//
// Keys are dispatched exactly as PF2e dispatches them: perception, spellcasting,
// a save slug, a weapon category, an armour category, or a class trait.
function subfeatureRankPath(key: string, classSlug: string | undefined): string | null {
  if (key === 'perception') return 'system.perception.rank'
  if (key === 'spellcasting') return 'system.proficiencies.spellcasting.rank'
  if (key in SAVE_ATTRIBUTES) return `system.saves.${key}.rank`
  if (WEAPON_CATEGORIES.includes(key)) return `system.proficiencies.attacks.${key}.rank`
  if (ARMOR_CATEGORIES.includes(key)) return `system.proficiencies.defenses.${key}.rank`
  // A class trait keys the class DC. Only the actor's own class is modelled;
  // an archetype's DC is a figure this engine does not derive.
  if (classSlug && key === classSlug) return 'system.proficiencies.classDCs.rank'
  return null
}

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
  for (const [slug, save] of Object.entries(source.saves ?? {}))
    put(`system.saves.${slug}.rank`, save?.rank)
  for (const [slug, skill] of Object.entries(source.skills ?? {}))
    put(`system.skills.${slug}.rank`, skill?.rank)
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
  spellcasting?: number
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
  floor('system.proficiencies.spellcasting.rank', klass?.spellcasting)

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
  // Feats' proficiency subfeatures, folded in before rule elements — the order
  // PF2e uses, since item `prepareActorData` runs ahead of the synthetics pass.
  const classSlug = (classItem(input.items)?.system as { slug?: string | null } | undefined)?.slug
  // Paths a feat's subfeature actually spoke to. That is positive evidence about
  // the rank, and it is what stops the caveat below firing on every save of
  // every character now that the mechanism is modelled.
  const explained = new Set<string>()
  for (const item of input.items) {
    const subfeatures = (
      item.system as
        { subfeatures?: { proficiencies?: Record<string, { rank?: number }> } } | undefined
    )?.subfeatures?.proficiencies
    for (const [key, entry] of Object.entries(subfeatures ?? {})) {
      const rank = entry?.rank
      if (typeof rank !== 'number' || !rank) continue
      const path = subfeatureRankPath(key, classSlug ?? undefined)
      if (!path) continue
      seed[path] = Math.max(seed[path] ?? 0, rank)
      explained.add(path)
    }
  }

  const context = contextFor(input)
  const bootstrap = buildRollOptions({
    level: input.level,
    traits: input.traits,
    items: input.items,
    activeRules: input.activeRules
  })
  const result = applyActiveEffectLikes(input.items, seed, bootstrap, context)

  // The `unconfirmable-rank` caveat used to be emitted here, for every save,
  // perception and armour rank that rested on the class baseline alone. It was
  // added when a rank raised by a rules-free class feature looked unrecoverable,
  // and it is deliberately gone.
  //
  // That mechanism turned out to be `subfeatures.proficiencies`, which is now
  // read — and the harness then measured ZERO total divergence across fourteen
  // payloads and ten characters, so the baseline is right wherever no subfeature
  // speaks. The caveat had stopped hedging anything and had become the thing it
  // was meant to prevent: a marker on five figures out of five, identical on all
  // of them, ranking nothing and teaching a reader to ignore it.
  //
  // If the harness ever shows a base divergence again, this is where the hedge
  // goes back — but it should come back with evidence, as it should have had.
  return { ranks: result.paths, skipped: result.skipped, applied: result.applied }
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
// A modifier the engine constructs rather than reads off a rule element.
//
// `label` is a stable English string, matching what PF2e names the same entry.
// It is NOT localized here — the engine has no locale — and the sheet maps the
// slugs it recognizes through its own i18n before display, falling back to this.
export function namedModifier(
  slug: string,
  label: string,
  modifier: number,
  type: string
): EngineModifier {
  return {
    slug,
    label,
    modifier,
    type,
    enabled: true,
    hideIfDisabled: false,
    force: false,
    source: ''
  }
}

// PF2e labels the proficiency entry by RANK — "Trained", "Expert" — not by the
// word "proficiency", so the rank has to travel with the bonus for the reported
// list to match the one PF2e sends.
const RANK_NAMES = ['untrained', 'trained', 'expert', 'master', 'legendary']

function baseModifiers(
  attributeSlug: string,
  attribute: number,
  proficiency: number,
  rank = 0
): EngineModifier[] {
  return [
    namedModifier(attributeSlug, attributeSlug, attribute, 'ability'),
    namedModifier('proficiency', RANK_NAMES[rank] ?? 'untrained', proficiency, 'proficiency')
  ]
}

// A figure inherits only the rank gaps that belong to it. Nothing emits
// `unconfirmable-rank` today (see deriveProficiencyRanks), but the filter stays:
// it is the rule that a skill must not be marked because a SAVE's rank was
// uncertain, and it would be needed again the moment such a gap is recorded.
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
  const resolved = resolveStacking(all)
  return {
    base: constant + applyStacking(seedModifiers),
    value: constant + applyStacking(all),
    // Reported with `enabled` resolved, so a breakdown shows which modifiers
    // actually applied rather than every one that was considered.
    modifiers: resolved,
    ledger: sealLedger(
      {
        applied: carried.applied + collected.applied,
        skipped: [...carried.skipped, ...collected.skipped]
      },
      versionVerdict(input.stamp)
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
    baseModifiers(
      attribute,
      input.attributes[attribute] ?? 0,
      proficiencyBonus(rank, input.level),
      rank
    ),
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
    baseModifiers(
      attribute,
      input.attributes[attribute] ?? 0,
      proficiencyBonus(rank, input.level),
      rank
    ),
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
    baseModifiers('wis', input.attributes.wis ?? 0, proficiencyBonus(rank, input.level), rank),
    PERCEPTION_DOMAINS,
    ranks,
    relevant(carried, ['system.perception.rank'])
  )
}

interface ArmorSystem {
  category?: string
  // PF2e slugs the armour modifier by `baseType ?? slug ?? sluggify(name)`.
  baseItem?: string | null
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
  // Only the 10 is a constant. PF2e builds the worn armour's contribution as a
  // single `item`-typed modifier labelled with the armour's name
  // (ArmorStatistic#createBonusesAndPenalties), and the potency rune is folded
  // into `acBonus` at prepare time rather than standing beside it
  // (ArmorPF2e#prepareDerivedData). Emitting it the same way is what makes the
  // derived modifier list match the one PF2e sends, and it is also more correct
  // than the two separate `item` entries this used to build: those contested
  // with each other, where PF2e contests once with their sum.
  //
  // The total is unchanged by construction — the same numbers, moved out of the
  // constant — which the differential harness checks against PF2e's own AC.
  const potency = system?.runes?.potency ?? 0
  const seeds = baseModifiers('dex', dex, proficiencyBonus(rank, input.level), rank)
  if (armor) {
    seeds.push(
      namedModifier(
        system?.baseItem ?? (armor.system as { slug?: string | null } | undefined)?.slug ?? 'armor',
        armor.name ?? 'Armor',
        (system?.acBonus ?? 0) + potency,
        'item'
      )
    )
  }
  return build(
    input,
    10,
    seeds,
    AC_DOMAINS,
    ranks,
    // Only the category actually worn: an unconfirmable heavy-armour rank is no
    // reason to doubt an unarmoured figure.
    relevant(carried, [`system.proficiencies.defenses.${category}.rank`])
  )
}

export function deriveClassDC(input: DerivationInput, keyAttribute: string): DerivedStatistic {
  const { ranks, ...carried } = deriveProficiencyRanks(input)
  const rank = ranks['system.proficiencies.classDCs.rank'] ?? 0
  return build(
    input,
    10,
    baseModifiers(
      keyAttribute,
      input.attributes[keyAttribute] ?? 0,
      proficiencyBonus(rank, input.level)
    ),
    ['class-dc', 'all'],
    ranks,
    relevant(carried, [])
  )
}

interface AncestrySystem {
  hp?: number
  size?: string
  speed?: number
  traits?: { value?: string[] }
}

// A character's traits and size, from the ancestry that grants them.
//
// Not a new figure so much as a correction. `system.traits` is absent from a
// world dump entirely — PF2e assembles it, copying the ancestry's traits and
// size onto the actor — and the engine's roll-option set declares `self:trait`
// a KNOWN family. So on a source-only sheet it was answering `self:trait:elf`
// with a confident FALSE for an elf, dropping every ancestry-predicated modifier
// with no skip recorded.
//
// The harness could not see it: it reads traits from the payload, which has
// them. That is the same "measuring an easier case" trap as feeding it prepared
// ranks, in a new place.
//
// Fixing it compounds. Trait predicates are a real share of the largest
// remaining skip category, so every one that now resolves is a modifier the
// engine stops guessing about.
export function deriveActorTraits(items: readonly EngineItem[]): string[] {
  const ancestry = items.find((item) => item.type === 'ancestry')?.system as
    AncestrySystem | undefined
  const traits = new Set(ancestry?.traits?.value ?? [])
  // `ActorTraits` adds and removes on the assembled set — a werewolf's beast
  // trait, an elixir granting a temporary one.
  for (const item of items) {
    for (const raw of item.system?.rules ?? []) {
      const rule = raw as { key?: string; add?: unknown; remove?: unknown }
      if (rule.key !== 'ActorTraits') continue
      for (const trait of Array.isArray(rule.add) ? rule.add : []) {
        if (typeof trait === 'string') traits.add(trait)
      }
      for (const trait of Array.isArray(rule.remove) ? rule.remove : []) {
        if (typeof trait === 'string') traits.delete(trait)
      }
    }
  }
  return [...traits]
}

// The ancestry's size, which is what PF2e copies onto `system.traits.size`.
// A `CreatureSize` rule element can change it; that is not modelled, and it is
// rare enough to be worth naming rather than pretending otherwise.
export function deriveActorSize(items: readonly EngineItem[]): string | undefined {
  const ancestry = items.find((item) => item.type === 'ancestry')?.system as
    AncestrySystem | undefined
  return ancestry?.size
}

export interface SpellcastingEntrySystem {
  ability?: { value?: string }
  tradition?: { value?: string }
  proficiency?: { value?: number; slug?: string | null }
}

// The domains PF2e collects a spellcasting entry's modifiers over. Exported
// because the differential harness has to ask the same question of the payload's
// modifier list: comparing over a different domain set would report divergence
// that is only the harness disagreeing with itself.
export function spellcastingDomains(
  attribute: string,
  tradition: string,
  kind: 'dc' | 'attack'
): string[] {
  const shared = ['all', `${attribute}-based`, 'spell-attack-dc']
  return kind === 'dc'
    ? [...shared, `${tradition}-spell-dc`, 'spell-dc']
    : [
        ...shared,
        `${tradition}-spell-attack`,
        'spell-attack',
        'spell-attack-roll',
        'attack',
        'attack-roll'
      ]
}

// A spellcasting entry's DC.
//
// Left out of the first Tier 2 pass on the assumption that it was "the same
// shape as class DC". It is not, and the difference is why: the rank is the
// GREATER of the entry's own `system.proficiency.value` and the actor's
// base-spellcasting rank, and the attribute is the entry's, not the class's —
// so a character with two entries can have two different DCs. PF2e's
// `SpellcastingEntryPF2e#prepareStatistic` does exactly that Math.max.
//
// The domains are the entry statistic's own plus the DC's, which is what PF2e
// collects a DC's modifiers over.
// The spellcasting statistic behind both the DC and the attack roll.
//
// PF2e builds one statistic per entry and reads a DC off it; the attack
// modifier is the same figure without the 10, over the attack domains rather
// than the DC's. Sharing the construction is not tidiness — it is what keeps the
// two from drifting apart when only one of them is touched.
function spellcastingStatistic(
  input: DerivationInput,
  entry: EngineItem,
  kind: 'dc' | 'attack'
): DerivedStatistic {
  const { ranks, ...carried } = deriveProficiencyRanks(input)
  const system = entry.system as unknown as SpellcastingEntrySystem | undefined
  const attribute = system?.ability?.value ?? 'int'
  const tradition = system?.tradition?.value ?? 'arcane'
  const rank = Math.max(
    system?.proficiency?.value ?? 0,
    ranks['system.proficiencies.spellcasting.rank'] ?? 0
  )
  const domains = spellcastingDomains(attribute, tradition, kind)
  return build(
    input,
    kind === 'dc' ? 10 : 0,
    baseModifiers(
      attribute,
      input.attributes[attribute] ?? 0,
      proficiencyBonus(rank, input.level),
      rank
    ),
    domains,
    ranks,
    relevant(carried, ['system.proficiencies.spellcasting.rank'])
  )
}

export function deriveSpellDC(input: DerivationInput, entry: EngineItem): DerivedStatistic {
  return spellcastingStatistic(input, entry, 'dc')
}

// The entry's spell attack modifier.
export function deriveSpellAttack(input: DerivationInput, entry: EngineItem): DerivedStatistic {
  return spellcastingStatistic(input, entry, 'attack')
}

// Initiative.
//
// Nearly free once the statistics exist: `system.initiative.statistic` is stored
// — it is the player's choice of which check rolls initiative — and the total is
// simply that statistic's. PF2e adds an `initiative` domain on top, so a
// modifier aimed there is collected as well.
export function deriveInitiative(
  input: DerivationInput,
  named: string | undefined,
  storedSkillRank: number
): DerivedStatistic {
  const slug = named ?? 'perception'
  const statistic =
    slug === 'perception'
      ? derivePerception(input)
      : deriveSkill(input, slug, storedSkillRank, { lore: !(slug in SKILL_ATTRIBUTES) })
  const { ranks, ...carried } = deriveProficiencyRanks(input)
  const extra = collectFlatModifiers(
    input.items,
    ['initiative'],
    optionsFor(input, ranks),
    contextFor(input)
  )
  return {
    base: statistic.base,
    value: statistic.value + applyStacking(extra.modifiers),
    modifiers: [...statistic.modifiers, ...resolveStacking(extra.modifiers)],
    ledger: sealLedger(
      {
        applied: statistic.ledger.applied + extra.applied,
        skipped: [...statistic.ledger.skipped, ...extra.skipped, ...carried.skipped]
      },
      versionVerdict(input.stamp)
    )
  }
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
    AncestrySystem | undefined
  const klass = classItem(input.items)?.system as ClassSystem | undefined
  // The same three parts PF2e reports, rather than one opaque total. Verified
  // against a live character: `ancestry-hp` +8, `class-hp` +30 and `hp-con` +15
  // for a level 5 wizard, summing to the 53 this used to produce as a constant.
  //
  // Splitting them is what lets the sheet show a breakdown without a GM, and it
  // costs nothing: `untyped` never loses a stacking contest, and `hp-con` is
  // `ability`-typed exactly as PF2e types it, so it contests with an ability
  // bonus to hit points the same way PF2e's does.
  const seeds: EngineModifier[] = [
    namedModifier('ancestry-hp', 'Ancestry HP', ancestry?.hp ?? 0, 'untyped'),
    namedModifier(
      'class-hp',
      'Class HP',
      ((klass?.hp ?? 0) + bonusPerLevel) * input.level,
      'untyped'
    ),
    namedModifier('hp-con', 'Constitution', (input.attributes.con ?? 0) * input.level, 'ability')
  ]
  return build(input, 0, seeds, ['hp', 'con-based'], ranks, relevant(carried, []))
}

// The focus pool maximum.
//
// This page recorded it as the one Tier 2 figure that was not arithmetic at all
// — "a count of which focus-pool-granting feats an actor has, and that list
// grows with every published book". That was wrong, and wrong in the same way
// the proficiency-rank claim was: it describes the RULEBOOK, not the system.
//
// PF2e never reads a stored maximum for a character. `prepareBaseData` does
//
//   d.focus = { value: d.focus?.value || 0, max: 0, cap: 3 }
//
// discarding whatever was on the actor, and then every SPELL the character
// knows that has the `focus` trait and is not a cantrip adds one
// (`SpellPF2e#prepareActorData`). The pool is a count of focus spells, which are
// items in plain source data — not a list of feats needing a lookup table.
//
// Two things can still move it, both of which the engine already handles:
// ActiveEffectLike rules writing `system.resources.focus.max` (a handful of
// psychic feats — every other such rule was stripped by a system migration) or
// `…focus.cap`, and the final clamp between zero and that cap.
export function deriveFocusPool(input: DerivationInput): {
  max: number
  cap: number
  ledger: Ledger
} {
  const spells = input.items.filter((item) => {
    if (item.type !== 'spell') return false
    const traits = (item.system as { traits?: { value?: string[] } } | undefined)?.traits?.value
    return !!traits?.includes('focus') && !traits.includes('cantrip')
  })

  const seed = {
    // Zero, not the stored value. PF2e overwrites it, so seeding from source
    // would double-count every focus spell on any character whose sheet had
    // been saved with a maximum already in it.
    'system.resources.focus.max': spells.length,
    'system.resources.focus.cap': 3
  }
  const { ranks } = deriveProficiencyRanks(input)
  const applied = applyActiveEffectLikes(
    input.items,
    seed,
    optionsFor(input, ranks),
    contextFor(input)
  )

  const cap = applied.paths['system.resources.focus.cap'] ?? 3
  const raw = applied.paths['system.resources.focus.max'] ?? 0
  return {
    max: Math.floor(Math.min(Math.max(raw, 0), cap)) || 0,
    cap,
    ledger: sealLedger(
      { applied: applied.applied, skipped: applied.skipped },
      versionVerdict(input.stamp)
    )
  }
}

// Movement speeds, over the same input as every other figure.
//
// The arithmetic lives in ./movement, which needs the resolved roll options and
// value context rather than a DerivationInput. This is the seam that keeps
// callers from having to build those themselves — and keeps the rank pass, which
// the option set depends on, from being forgotten.
export function deriveMovement(input: DerivationInput): Record<MovementType, DerivedSpeed | null> {
  const { ranks } = deriveProficiencyRanks(input)
  return deriveSpeeds({
    items: input.items,
    strength: input.attributes.str ?? 0,
    options: optionsFor(input, ranks),
    context: contextFor(input),
    stamp: input.stamp
  })
}

// Immunities, weaknesses and resistances, over the same input as every other
// figure. The seam that keeps callers from assembling roll options and a value
// context themselves — and from forgetting the rank pass the options depend on.
export function deriveIWR(input: DerivationInput, stored?: unknown): DerivedIWR {
  const { ranks } = deriveProficiencyRanks(input)
  return deriveIWRSets({
    items: input.items,
    stored: (stored ?? {}) as Partial<Record<'immunities' | 'weaknesses' | 'resistances', unknown>>,
    options: optionsFor(input, ranks),
    context: contextFor(input),
    stamp: input.stamp
  })
}
