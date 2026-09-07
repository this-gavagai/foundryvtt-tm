import { computed, type ComputedRef, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import type { TablemateCharacter } from '@/types/character-types'
import { useLabelCatalogsStore } from '@/stores/labelCatalogs'
import { asDocumentArray } from '@/api/internal'
import { calcAttribute } from './calcAttributes'
import {
  deriveArmorClass,
  deriveHitPointsMax,
  derivePerception,
  deriveSave,
  deriveActorTraits,
  deriveSkill,
  deriveSpellAttack,
  deriveSpellDC,
  deriveInitiative,
  deriveFocusPool,
  deriveIWR,
  deriveMovement,
  type DerivationInput,
  readStoredRanks,
  type DerivedStatistic
} from '@/utils/ruleEngine/statistics'
import type { EngineItem, EngineModifier } from '@/utils/ruleEngine/flatModifiers'
import type { MovementType } from '@/utils/ruleEngine/movement'
import type { DerivedIWR } from '@/utils/ruleEngine/iwr'
import { describeLedger, type ConditionalModifier } from '@/utils/ruleEngine/ledger'

// The engine's figures, derived for this actor.
//
// Every one is a FALLBACK. A character payload's number wins whenever there is
// one, because it came from PF2e itself; these exist for the sheet painted from
// the world dump alone, where the alternative is a blank.
//
// Each carries its ledger, and the sheet is expected to mark anything not
// `exact`: a provisional number shown as though it were PF2e's is worse than no
// number, because it is indistinguishable from a correct one and a player will
// act on it. See utils/ruleEngine/README.md.

export interface DerivedFigure {
  value: number
  provisional: boolean
  // Human-readable account of what was not evaluated, for a tooltip.
  caveat: string
  // The parts the figure is made of, with stacking already resolved, in the
  // engine's own naming. Present on every figure; the sheet reads it only where
  // PF2e sent no list of its own.
  modifiers: EngineModifier[]
  // Modifiers waiting on a roll — "+2 vs traps". Resolved correctly and not
  // applying NOW, which makes them part of the breakdown rather than a gap in
  // it; see derivedModifiers.present. Kept separate from `modifiers` up to the
  // point of display so nothing can mistake one for a contributor.
  conditional: ConditionalModifier[]
}

export interface DerivedStatistics {
  armorClass: ComputedRef<DerivedFigure | undefined>
  hitPointsMax: ComputedRef<DerivedFigure | undefined>
  perception: ComputedRef<DerivedFigure | undefined>
  save: (slug: string) => ComputedRef<DerivedFigure | undefined>
  skill: (slug: string, rank: number, lore?: boolean) => DerivedFigure | undefined
  // Per spellcasting entry: a character can carry two, keyed off different
  // attributes and proficiencies, so there is no single answer.
  spellDC: (entry: EngineItem) => DerivedFigure | undefined
  spellAttack: (entry: EngineItem) => DerivedFigure | undefined
  initiative: (named: string | undefined, rank: number) => DerivedFigure | undefined
  // Null where the character simply has no such speed — distinct from a figure
  // the engine could not compute, which comes back undefined.
  speed: (type: MovementType) => (DerivedFigure | null) | undefined
  focusPoolMax: ComputedRef<DerivedFigure | undefined>
  // Immunities, weaknesses and resistances, seeded from the actor's own
  // authored entries and grown by rule elements. Undefined only when there is
  // no actor to derive from.
  iwr: ComputedRef<DerivedIWR | undefined>
}

function present(result: DerivedStatistic): DerivedFigure {
  return {
    value: result.value,
    provisional: result.ledger.confidence !== 'exact',
    caveat: describeLedger(result.ledger),
    modifiers: result.modifiers,
    conditional: result.ledger.conditional
  }
}

// The engine input for one actor, as a plain function.
//
// Lifted out of the composable so the write-time reconciler can build the same
// input without a reactive context: it has to compute every figure at once and
// compare, which is not a render.
export function derivationInputFor(
  actor: Ref<TablemateCharacter | undefined>,
  stamp: string | undefined
): DerivationInput | undefined {
  const level = actor.value?.system?.details?.level?.value
  if (typeof level !== 'number') return undefined
  // Read here rather than passed in, because every caller would otherwise have
  // to know to fetch it. Pinia is active wherever the sheet is; a missing store
  // costs the vocabulary, not the derivation.
  let traits: readonly string[] | undefined
  try {
    traits = Object.keys(useLabelCatalogsStore().catalogs.traits ?? {})
  } catch {
    traits = undefined
  }
  const items = (asDocumentArray(actor.value?.items) ?? []) as EngineItem[]
  const attribute = (key: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha') =>
    actor.value?.system?.abilities?.[key]?.mod ?? calcAttribute(actor, key) ?? 0
  return {
    items,
    level,
    attributes: {
      str: attribute('str'),
      dex: attribute('dex'),
      con: attribute('con'),
      int: attribute('int'),
      wis: attribute('wis'),
      cha: attribute('cha')
    },
    // Prepared traits when a payload supplied them; otherwise assembled from
    // the ancestry, which is where PF2e gets them. Empty would not be neutral
    // here — the option set treats `self:trait` as a family it knows, so an
    // absent trait reads as a definite "no".
    traits:
      (actor.value?.system?.traits as { value?: string[] } | undefined)?.value ??
      deriveActorTraits(items),
    // Whatever ranks this actor already carries. On the world-dump path that
    // is usually nothing for saves and perception, and a partial set for
    // skills — the class item's ranks then act as the floor.
    storedRanks: readStoredRanks(actor.value?.system),
    activeRules: actor.value?.activeRules ?? [],
    // PF2e's own option set, when a GM has answered for this actor. Where it is
    // present the engine stops inferring toggle states and reads them.
    rollOptionSet: actor.value?.rollOptionSet,
    // The world's trait names, which is how a bare predicate atom is told apart
    // from a toggle slug. Absent until the catalog is published, and absent is
    // the conservative reading — every bare atom stays opaque.
    traitVocabulary: traits,
    stamp
  }
}

export function useDerivedStatistics(
  actor: Ref<TablemateCharacter | undefined>
): DerivedStatistics {
  const { stamp } = storeToRefs(useLabelCatalogsStore())

  // ONE input object per actor change, and its identity matters: the engine
  // caches this actor's proficiency ranks, roll options and value context
  // against it (see `resolve` in ruleEngine/statistics), so every figure on the
  // sheet shares one pass over the item list instead of repeating it. Handing
  // out a fresh object per figure would silently restore the old cost.
  const input = computed<DerivationInput | undefined>(() => derivationInputFor(actor, stamp.value))

  const speeds = computed(() => (input.value ? deriveMovement(input.value) : undefined))

  const figure = (build: (source: DerivationInput) => DerivedStatistic) =>
    computed(() => {
      const source = input.value
      return source ? present(build(source)) : undefined
    })

  return {
    armorClass: figure(deriveArmorClass),
    hitPointsMax: figure(deriveHitPointsMax),
    perception: figure(derivePerception),
    save: (slug: string) => figure((source) => deriveSave(source, slug)),
    // Not a computed: skills are built inside an existing loop over the actor's
    // skill list, so the caller already has the rank and re-derives per entry.
    skill: (slug: string, rank: number, lore = false) => {
      const source = input.value
      return source ? present(deriveSkill(source, slug, rank, { lore })) : undefined
    },
    spellDC: (entry: EngineItem) => {
      const source = input.value
      return source ? present(deriveSpellDC(source, entry)) : undefined
    },
    spellAttack: (entry: EngineItem) => {
      const source = input.value
      return source ? present(deriveSpellAttack(source, entry)) : undefined
    },
    initiative: (named: string | undefined, rank: number) => {
      const source = input.value
      return source ? present(deriveInitiative(source, named, rank)) : undefined
    },
    // One derivation for all five: the non-land speeds are scored against land's
    // own total, so computing them separately would mean building land five
    // more times.
    speed: (type: MovementType) => {
      const source = input.value
      if (!source) return undefined
      const speed = speeds.value?.[type]
      return speed ? present(speed) : null
    },
    iwr: computed(() => {
      const source = input.value
      if (!source) return undefined
      // The authored entries are the seed, not an alternative to the rules:
      // PF2e merges rule-element IWR into whatever the actor already carries.
      return deriveIWR(source, actor.value?.system?.attributes)
    }),
    focusPoolMax: computed(() => {
      const source = input.value
      if (!source) return undefined
      const pool = deriveFocusPool(source)
      return {
        value: pool.max,
        provisional: pool.ledger.confidence !== 'exact',
        caveat: describeLedger(pool.ledger),
        modifiers: [],
        conditional: pool.ledger.conditional
      }
    })
  }
}
