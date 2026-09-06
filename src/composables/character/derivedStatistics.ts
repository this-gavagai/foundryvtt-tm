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
  deriveSkill,
  type DerivationInput,
  readStoredRanks,
  type DerivedStatistic
} from '@/utils/ruleEngine/statistics'
import type { EngineItem } from '@/utils/ruleEngine/flatModifiers'
import { describeLedger } from '@/utils/ruleEngine/ledger'

// The Tier-2 figures, derived for this actor.
//
// Every one of these is a FALLBACK. A character payload's number wins whenever
// there is one, without exception, because it came from PF2e itself. These exist
// for the sheet painted from the world dump alone, where the alternative is a
// blank where a save or an AC should be.
//
// Each carries its ledger, and the sheet is expected to mark anything that is
// not `exact`. A provisional number shown as though it were PF2e's is worse than
// no number: it is indistinguishable from a correct one, and a player will act
// on it.

export interface DerivedFigure {
  value: number
  provisional: boolean
  // Human-readable account of what was not evaluated, for a tooltip.
  caveat: string
}

export interface DerivedStatistics {
  armorClass: ComputedRef<DerivedFigure | undefined>
  hitPointsMax: ComputedRef<DerivedFigure | undefined>
  perception: ComputedRef<DerivedFigure | undefined>
  save: (slug: string) => ComputedRef<DerivedFigure | undefined>
  skill: (slug: string, rank: number, lore?: boolean) => DerivedFigure | undefined
}

function present(result: DerivedStatistic): DerivedFigure {
  return {
    value: result.value,
    provisional: result.ledger.confidence !== 'exact',
    caveat: describeLedger(result.ledger)
  }
}

export function useDerivedStatistics(
  actor: Ref<TablemateCharacter | undefined>
): DerivedStatistics {
  const { stamp } = storeToRefs(useLabelCatalogsStore())

  // Built once per actor change and shared by every figure: the AE-like pass it
  // drives is over the whole item list, so recomputing it per statistic would
  // repeat the same work a dozen times on every render.
  const input = computed<DerivationInput | undefined>(() => {
    const level = actor.value?.system?.details?.level?.value
    if (typeof level !== 'number') return undefined
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
      traits: (actor.value?.system?.traits as { value?: string[] } | undefined)?.value ?? [],
      // Whatever ranks this actor already carries. On the world-dump path that
      // is usually nothing for saves and perception, and a partial set for
      // skills — the class item's ranks then act as the floor.
      storedRanks: readStoredRanks(actor.value?.system),
      activeRules: actor.value?.activeRules ?? [],
      stamp: stamp.value
    }
  })

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
    }
  }
}
