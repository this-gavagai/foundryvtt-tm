import { computed, type Ref } from 'vue'
import type { Actor } from '@/types/pf2e-types'
import type { Field } from './helpers'
import { type Modifier, makeModifiers } from './modifier'
import { type Stat, makeStat } from './stat'
import { type IWR, makeIWRs } from './iwr'
import { useApi } from '../api'
export interface CharacterStats {
  // stats
  attributes: {
    str: Field<number>
    dex: Field<number>
    con: Field<number>
    int: Field<number>
    wis: Field<number>
    cha: Field<number>
  }
  ac: {
    current: Field<number>
    modifiers: Field<Modifier[]>
  }
  saves: {
    fortitude: Field<Stat>
    reflex: Field<Stat>
    will: Field<Stat>
  }
  perception: Field<Stat>
  immunities: Field<IWR[]>
  weaknesses: Field<IWR[]>
  resistances: Field<IWR[]>
  spellDC: Field<number>
}

export function useCharacterStats(actor: Ref<Actor | undefined>) {
  const { rollCheck } = useApi()
  return {
    attributes: {
      str: computed(() => actor.value?.system?.abilities?.str?.mod),
      dex: computed(() => actor.value?.system?.abilities?.dex?.mod),
      con: computed(() => actor.value?.system?.abilities?.con?.mod),
      int: computed(() => actor.value?.system?.abilities?.int?.mod),
      wis: computed(() => actor.value?.system?.abilities?.wis?.mod),
      cha: computed(() => actor.value?.system?.abilities?.cha?.mod)
    },
    ac: {
      current: computed(() => actor.value?.system?.attributes?.ac?.value),
      modifiers: computed(() => makeModifiers(actor.value?.system?.attributes?.ac?.modifiers))
    },
    saves: {
      fortitude: computed(() => ({
        ...(makeStat(actor.value?.system?.saves?.fortitude) as Stat),
        roll: () => rollCheck(actor as Ref<Actor>, 'save', 'fortitude')
      })),
      reflex: computed(() => ({
        ...(makeStat(actor.value?.system?.saves?.reflex) as Stat),
        roll: () => rollCheck(actor as Ref<Actor>, 'save', 'reflex')
      })),
      will: computed(() => ({
        ...(makeStat(actor.value?.system?.saves?.will) as Stat),
        roll: () => rollCheck(actor as Ref<Actor>, 'save', 'will')
      }))
    },
    perception: computed(() => ({
      ...(makeStat(actor.value?.system?.perception) as Stat),
      roll: () => rollCheck(actor as Ref<Actor>, 'perception', '')
    })),
    immunities: computed(() => makeIWRs(actor.value?.system?.attributes?.immunities)),
    weaknesses: computed(() => makeIWRs(actor.value?.system?.attributes?.weaknesses)),
    resistances: computed(() => makeIWRs(actor.value?.system?.attributes?.resistances)),
    spellDC: computed(() => actor.value?.system?.attributes?.spellDC?.value)
  }
}
