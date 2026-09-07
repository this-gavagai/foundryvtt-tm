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

// The figures that are reproducible from source once rule elements are
// accounted for.
//
// Each is the same shape: a base computed from stored data, plus whatever the
// engine can account for on top, plus a ledger saying what it could not. The
// base is where PF2e's arithmetic lives; the engine is where its content lives;
// the ledger is what makes the sum safe to show.
//
// See ../README.md. `resolve` below is the file's hot path and the one thing to
// understand before editing here.

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
  // PF2e's own roll-option set for this actor, when a GM has sent one. The
  // authority; see rollOptions.rollOptionSet.
  rollOptionSet?: readonly string[]
  // Every trait slug the world's PF2e defines. Distinguishes a bare predicate
  // atom that names one of the ROLL's traits (`emotion`, `trap`) from one that
  // names a toggle (`ageless-patience`); the strings are indistinguishable
  // otherwise. See rollOptions.traitVocabulary.
  traitVocabulary?: readonly string[]
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

// The app's internal rank path → PF2e's own roll-option key.
//
// Read off pf2e 8.4.1's statistic construction. The paths this engine keys ranks
// by are Foundry document paths and are NOT those strings, so the mapping has to
// be explicit.
//
// Class DC and base spellcasting are deliberately absent: PF2e builds those
// through the generic `${slug}:rank:${n}` on a Statistic whose slug this engine
// does not know for certain, and an invented string would be a family claimed as
// enumerated that nothing can match.
const RANK_OPTION_KEYS: { pattern: RegExp; key: (match: RegExpMatchArray) => string }[] = [
  { pattern: /^system\.saves\.([^.]+)\.rank$/, key: (m) => `save:${m[1]}:rank` },
  { pattern: /^system\.skills\.([^.]+)\.rank$/, key: (m) => `skill:${m[1]}:rank` },
  { pattern: /^system\.perception\.rank$/, key: () => 'perception:rank' },
  {
    pattern: /^system\.proficiencies\.defenses\.([^.]+)\.rank$/,
    key: (m) => `defense:${m[1]}:rank`
  },
  {
    pattern: /^system\.proficiencies\.attacks\.([^.]+)\.rank$/,
    key: (m) => `attack:${m[1]}:rank`
  }
]

function rankOptionsFor(ranks: Record<string, number>): string[] {
  const out: string[] = []
  for (const [path, rank] of Object.entries(ranks)) {
    for (const { pattern, key } of RANK_OPTION_KEYS) {
      const match = path.match(pattern)
      if (match) {
        out.push(`${key(match)}:${rank}`)
        break
      }
    }
  }
  return out
}

// Everything about one actor that every figure needs and none of them should
// compute for itself: the proficiency ranks, the roll-option set, the value
// context, and the rank pass's own ledger.
//
// THIS IS THE FILE'S HOT PATH. The rank pass runs the ActiveEffectLike pass over
// every item and rule on the actor; done per figure, a full sheet fires it 27
// times — measured at 4.4ms for a 102-item character on a desktop, repeated by
// the reconciler on every write and the dev harness on every payload.
//
// The ordering is real: the AE-like pass needs an option set to test predicates
// against, and the option set wants the ranks that pass produces. So the set is
// built twice — a BOOTSTRAP without ranks, then the real one — and once per
// actor, not twice per figure.
interface Resolved {
  ranks: Record<string, number>
  carried: { applied: number; skipped: SkippedRule[] }
  options: RollOptionSet
  context: ValueContext
}

// Keyed on the input OBJECT, not its contents. The sheet builds one
// `DerivationInput` per actor change and hands the same object to every figure,
// so identity is stable for the life of a render and a changed actor produces a
// new object that cannot hit a stale entry. A content hash would cost more than
// the pass it saves; a Map would leak every actor the app has shown.
const resolvedCache = new WeakMap<DerivationInput, Resolved>()

function resolve(input: DerivationInput): Resolved {
  const cached = resolvedCache.get(input)
  if (cached) return cached
  const context = contextFor(input)
  const { ranks, ...carried } = deriveProficiencyRanks(input, context)
  const options = buildRollOptions({
    level: input.level,
    traits: input.traits,
    items: input.items,
    activeRules: input.activeRules,
    rollOptionSet: input.rollOptionSet,
    traitVocabulary: input.traitVocabulary,
    rankOptions: rankOptionsFor(ranks)
  })
  const result: Resolved = { ranks, carried, options, context }
  resolvedCache.set(input, result)
  return result
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
// Exported for the tests that pin the seeding rules. Production reaches it
// through `resolve`, which runs it ONCE per actor — see the note there.
export function deriveProficiencyRanks(
  input: DerivationInput,
  // Passed in rather than rebuilt, so `resolve` builds it once and this cannot
  // disagree with the context every figure is later evaluated against.
  context: ValueContext = contextFor(input)
): {
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

  // The BOOTSTRAP option set: no ranks in it, because the ranks are what this
  // pass produces. `resolve` builds the real one on top of the result.
  const bootstrap = buildRollOptions({
    level: input.level,
    traits: input.traits,
    items: input.items,
    activeRules: input.activeRules,
    rollOptionSet: input.rollOptionSet,
    traitVocabulary: input.traitVocabulary
  })
  const result = applyActiveEffectLikes(input.items, seed, bootstrap, context)

  // A rank resting on the class baseline alone is NOT hedged, and that is a
  // decision with evidence behind it: the mechanism that raises save,
  // perception and armour ranks is `subfeatures.proficiencies`, which is read
  // above, and the harness then measured zero base divergence across the test
  // table. If it ever shows one again, a hedge belongs here — with its own
  // evidence, as this one should have had.
  return { ranks: result.paths, skipped: result.skipped, applied: result.applied }
}

// A modifier the engine constructs rather than reads off a rule element.
//
// The attribute and proficiency components of a statistic are TYPED MODIFIERS,
// not a flat base, and that is what makes stacking correct: PF2e builds both with
// `createAttributeModifier` / `createProficiencyModifier` and lets them contest
// anything of the same type. Untrained Improvisation is `proficiency`-typed, so
// on a TRAINED skill it loses to the real proficiency bonus and contributes
// nothing — which cannot happen if the base is held outside the contest.
//
// `label` is a stable English string matching what PF2e names the same entry. It
// is NOT localized here — the engine has no locale — and the sheet maps the slugs
// it recognizes through its own i18n, falling back to this.
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

function build(
  input: DerivationInput,
  // A constant that takes part in no contest — AC's 10, an armour's own AC
  // bonus. Everything that CAN contest arrives through `seedModifiers`.
  constant: number,
  seedModifiers: EngineModifier[],
  domains: readonly string[],
  // The one resolve for this actor: ranks, roll options, value context and the
  // rank pass's own ledger, all shared.
  shared: Resolved
): DerivedStatistic {
  const carried = shared.carried
  const collected = collectFlatModifiers(input.items, domains, shared.options, shared.context)
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
        skipped: [...carried.skipped, ...collected.skipped],
        conditional: collected.conditional
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
  const shared = resolve(input)
  const { ranks } = shared
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
    shared
  )
}

export function deriveSave(input: DerivationInput, slug: string): DerivedStatistic {
  const shared = resolve(input)
  const attribute = SAVE_ATTRIBUTES[slug] ?? 'con'
  const rank = shared.ranks[`system.saves.${slug}.rank`] ?? 0
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
    shared
  )
}

export function derivePerception(input: DerivationInput): DerivedStatistic {
  const shared = resolve(input)
  const rank = shared.ranks['system.perception.rank'] ?? 0
  return build(
    input,
    0,
    baseModifiers('wis', input.attributes.wis ?? 0, proficiencyBonus(rank, input.level), rank),
    PERCEPTION_DOMAINS,
    shared
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
  const shared = resolve(input)
  const armor = wornArmor(input.items)
  const system = armor?.system as unknown as ArmorSystem | undefined
  const category = system?.category ?? 'unarmored'
  const rank = shared.ranks[`system.proficiencies.defenses.${category}.rank`] ?? 0
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
    shared
  )
}

export function deriveClassDC(input: DerivationInput, keyAttribute: string): DerivedStatistic {
  const shared = resolve(input)
  const rank = shared.ranks['system.proficiencies.classDCs.rank'] ?? 0
  return build(
    input,
    10,
    baseModifiers(
      keyAttribute,
      input.attributes[keyAttribute] ?? 0,
      proficiencyBonus(rank, input.level)
    ),
    ['class-dc', 'all'],
    shared
  )
}

interface AncestrySystem {
  hp?: number
  size?: string
  speed?: number
  traits?: { value?: string[] }
}

// A character's traits, from the ancestry that grants them.
//
// `system.traits` is absent from a world dump entirely — PF2e assembles it,
// copying the ancestry's traits and size onto the actor — while the roll-option
// set declares `self:trait` a KNOWN family. So without this an elf's
// `self:trait:elf` answers a confident FALSE and every ancestry-predicated
// modifier is dropped with no skip recorded.
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

// The spellcasting statistic behind both the DC and the attack roll.
//
// PF2e builds one per entry and reads a DC off it; the attack modifier is the
// same figure without the 10, over the attack domains rather than the DC's.
// Sharing the construction keeps the two from drifting when only one is touched.
//
// NOT the same shape as class DC: the rank is the GREATER of the entry's own
// `system.proficiency.value` and the actor's base-spellcasting rank, and the
// attribute is the ENTRY's — so a character with two entries can have two
// different DCs. PF2e's `SpellcastingEntryPF2e#prepareStatistic` does that
// Math.max.
function spellcastingStatistic(
  input: DerivationInput,
  entry: EngineItem,
  kind: 'dc' | 'attack'
): DerivedStatistic {
  const shared = resolve(input)
  const system = entry.system as unknown as SpellcastingEntrySystem | undefined
  const attribute = system?.ability?.value ?? 'int'
  const tradition = system?.tradition?.value ?? 'arcane'
  const rank = Math.max(
    system?.proficiency?.value ?? 0,
    shared.ranks['system.proficiencies.spellcasting.rank'] ?? 0
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
    shared
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
  const shared = resolve(input)
  const extra = collectFlatModifiers(input.items, ['initiative'], shared.options, shared.context)
  return {
    base: statistic.base,
    value: statistic.value + applyStacking(extra.modifiers),
    modifiers: [...statistic.modifiers, ...resolveStacking(extra.modifiers)],
    ledger: sealLedger(
      {
        applied: statistic.ledger.applied + extra.applied,
        // The rank pass's own skips are already in `statistic.ledger` — it was
        // built from the same resolve — so folding them in again double-counted
        // every one of them on this figure alone.
        skipped: [...statistic.ledger.skipped, ...extra.skipped],
        conditional: [...statistic.ledger.conditional, ...extra.conditional]
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
  const shared = resolve(input)
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
  return build(input, 0, seeds, ['hp', 'con-based'], shared)
}

// The focus pool maximum: a COUNT OF FOCUS SPELLS, not a lookup of which feats
// grant focus.
//
// PF2e never reads a stored maximum for a character. `prepareBaseData` does
//
//   d.focus = { value: d.focus?.value || 0, max: 0, cap: 3 }
//
// discarding whatever was on the actor, and then every spell the character knows
// with the `focus` trait that is not a cantrip adds one
// (`SpellPF2e#prepareActorData`). Those are items in plain source data.
//
// Two things move it, both already handled: ActiveEffectLike rules writing
// `system.resources.focus.max` or `…focus.cap`, and the clamp between zero and
// that cap.
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
  const shared = resolve(input)
  const applied = applyActiveEffectLikes(input.items, seed, shared.options, shared.context)

  const cap = applied.paths['system.resources.focus.cap'] ?? 3
  const raw = applied.paths['system.resources.focus.max'] ?? 0
  return {
    max: Math.floor(Math.min(Math.max(raw, 0), cap)) || 0,
    cap,
    ledger: sealLedger(
      { applied: applied.applied, skipped: applied.skipped, conditional: applied.conditional },
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
  const shared = resolve(input)
  return deriveSpeeds({
    items: input.items,
    strength: input.attributes.str ?? 0,
    options: shared.options,
    context: shared.context,
    stamp: input.stamp
  })
}

// Immunities, weaknesses and resistances, over the same input as every other
// figure. The seam that keeps callers from assembling roll options and a value
// context themselves — and from forgetting the rank pass the options depend on.
export function deriveIWR(input: DerivationInput, stored?: unknown): DerivedIWR {
  const shared = resolve(input)
  return deriveIWRSets({
    items: input.items,
    stored: (stored ?? {}) as Partial<Record<'immunities' | 'weaknesses' | 'resistances', unknown>>,
    options: shared.options,
    context: shared.context,
    stamp: input.stamp
  })
}
