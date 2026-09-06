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
  return { ranks: result.paths, skipped: result.skipped, applied: result.applied }
}

function build(
  input: DerivationInput,
  base: number,
  domains: readonly string[],
  ranks: Record<string, number>,
  carried: { applied: number; skipped: SkippedRule[] }
): DerivedStatistic {
  const options = optionsFor(input, ranks)
  const collected = collectFlatModifiers(input.items, domains, options, contextFor(input))
  return {
    base,
    value: base + applyStacking(collected.modifiers),
    modifiers: collected.modifiers,
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
  const base = (input.attributes[attribute] ?? 0) + proficiencyBonus(rank, input.level)
  const domains = options.lore ? loreDomains(slug) : skillDomains(slug, attribute)
  return build(input, base, domains, ranks, carried)
}

export function deriveSave(input: DerivationInput, slug: string): DerivedStatistic {
  const { ranks, ...carried } = deriveProficiencyRanks(input)
  const attribute = SAVE_ATTRIBUTES[slug] ?? 'con'
  const rank = ranks[`system.saves.${slug}.rank`] ?? 0
  const base = (input.attributes[attribute] ?? 0) + proficiencyBonus(rank, input.level)
  return build(input, base, saveDomains(slug, attribute), ranks, carried)
}

export function derivePerception(input: DerivationInput): DerivedStatistic {
  const { ranks, ...carried } = deriveProficiencyRanks(input)
  const rank = ranks['system.perception.rank'] ?? 0
  const base = (input.attributes.wis ?? 0) + proficiencyBonus(rank, input.level)
  return build(input, base, PERCEPTION_DOMAINS, ranks, carried)
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
  const base =
    10 + dex + proficiencyBonus(rank, input.level) + (system?.acBonus ?? 0) + (system?.runes?.potency ?? 0)
  return build(input, base, AC_DOMAINS, ranks, carried)
}

export function deriveClassDC(input: DerivationInput, keyAttribute: string): DerivedStatistic {
  const { ranks, ...carried } = deriveProficiencyRanks(input)
  const rank = ranks['system.proficiencies.classDCs.rank'] ?? 0
  const base = 10 + (input.attributes[keyAttribute] ?? 0) + proficiencyBonus(rank, input.level)
  return build(input, base, ['class-dc', 'all'], ranks, carried)
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
  const base = (ancestry?.hp ?? 0) + perLevel * input.level
  return build(input, base, ['hp', 'con-based'], ranks, carried)
}
