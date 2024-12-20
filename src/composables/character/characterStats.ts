import { computed, type Ref } from 'vue'
import type { Actor } from '@/types/pf2e-types'
import type { Field, WritableField } from './helpers'
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
  shield: {
    hp: {
      current: WritableField<number>
      max: Field<number>
      brokenThreshold: Field<number>
    }
    ac: Field<number>
    hardness: Field<number>
    raised: Field<boolean>
    broken: Field<boolean>
    destroyed: Field<boolean>
    itemId: Field<string>
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
  const { rollCheck, updateActorItem } = useApi()
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

    shield: {
      hp: {
        current: computed({
          get: () => actor.value?.system?.attributes?.shield?.hp?.value,
          set: (newValue) => {
            console.log(newValue)
            const shieldId = actor.value?.system?.attributes?.shield?.itemId
            // const shieldItem = actor.value?.items.find((i: PF2eItem) => i._id === shieldId)
            // console.log(shieldItem)
            // if (shieldItem?.system?.hp) shieldItem.system.hp.value = newValue
            actor.value!.system.attributes.shield.hp.value = newValue
            const update = { system: { hp: { value: newValue } } }
            updateActorItem(actor as Ref<Actor>, shieldId, update)
          }
        }),
        max: computed(() => actor.value?.system?.attributes?.shield?.hp?.max),
        brokenThreshold: computed(
          () => actor.value?.system?.attributes?.shield?.hp?.brokenThreshold
        )
      },
      ac: computed(() => actor.value?.system?.attributes?.shield?.ac),
      hardness: computed(() => actor.value?.system?.attributes?.shield?.hardness),
      raised: computed(() => actor.value?.system?.attributes?.shield?.raised),
      broken: computed(() => actor.value?.system?.attributes?.shield?.broken),
      destroyed: computed(() => actor.value?.system?.attributes?.shield?.destroyed),
      itemId: computed(() => actor.value?.system?.attributes?.shield?.itemId)
    },

    saves: {
      fortitude: computed(() => ({
        ...(makeStat(actor.value?.system?.saves?.fortitude) as Stat),
        roll: (result: number | undefined) =>
          rollCheck(actor as Ref<Actor>, 'save', 'fortitude', { d20: [result ?? 0] })
      })),
      reflex: computed(() => ({
        ...(makeStat(actor.value?.system?.saves?.reflex) as Stat),
        roll: (result: number | undefined) =>
          rollCheck(actor as Ref<Actor>, 'save', 'reflex', { d20: [result ?? 0] })
      })),
      will: computed(() => ({
        ...(makeStat(actor.value?.system?.saves?.will) as Stat),
        roll: (result: number | undefined) =>
          rollCheck(actor as Ref<Actor>, 'save', 'will', { d20: [result ?? 0] })
      }))
    },
    perception: computed(() => ({
      ...(makeStat(actor.value?.system?.perception) as Stat),
      roll: (result: number | undefined) =>
        rollCheck(actor as Ref<Actor>, 'perception', '', { d20: [result ?? 0] })
    })),
    immunities: computed(() => makeIWRs(actor.value?.system?.attributes?.immunities)),
    weaknesses: computed(() => makeIWRs(actor.value?.system?.attributes?.weaknesses)),
    resistances: computed(() => makeIWRs(actor.value?.system?.attributes?.resistances)),
    spellDC: computed(() => actor.value?.system?.attributes?.spellDC?.value)
  }
}
