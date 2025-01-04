import type { Ref } from 'vue'
import { computed } from 'vue'
import type { Actor, Item as PF2eItem, Movement as PF2eMovement } from '@/types/pf2e-types'
import type { Field, WritableField } from './helpers'
import { type Item, makeItem } from './item'
import { type Stat, makeStat } from './stat'
import { useApi } from '../api'

export interface CharacterCore {
  _id: Field<string>
  name: Field<string>
  portraitUrl: Field<string>
  ancestry: Field<Item>
  heritage: Field<Item>
  background: Field<Item>
  classType: Field<Item>
  level: Field<number>
  xp: {
    current: WritableField<number>
    max: Field<number>
  }
  movement: {
    land: Field<Stat>
    swim: Field<Stat>
    climb: Field<Stat>
    fly: Field<Stat>
    burrow: Field<Stat>
  }
  languages: Field<string[]>
}

export function useCharacterCore(actor: Ref<Actor | undefined>): CharacterCore {
  const { updateActor } = useApi()
  return {
    _id: computed(() => actor.value?._id),
    name: computed(() => actor.value?.name),
    portraitUrl: computed(() => actor.value?.prototypeToken?.texture?.src),
    ancestry: computed(() => ({
      ...(makeItem(actor.value?.items?.find((x: PF2eItem) => x.type === 'ancestry')) as Item)
    })),
    background: computed(() => ({
      ...(makeItem(actor.value?.items?.find((x: PF2eItem) => x.type === 'background')) as Item)
    })),
    heritage: computed(() => ({
      ...(makeItem(actor.value?.items?.find((x: PF2eItem) => x.type === 'heritage')) as Item)
    })),
    classType: computed(() => ({
      ...(makeItem(actor.value?.items?.find((x: PF2eItem) => x.type === 'class')) as Item)
    })),
    level: computed(() => actor.value?.system?.details?.level?.value),
    xp: {
      current: computed({
        get: () => actor.value?.system?.details?.xp?.value,
        set: (newValue) => {
          actor.value!.system.details.xp.value = newValue
          const update = { system: { details: { xp: { value: newValue } } } }
          updateActor(actor, update)
        }
      }),
      max: computed(() => actor.value?.system?.details?.xp?.max)
    },
    movement: {
      land: computed(() => makeStat(actor.value?.system?.attributes?.speed)),
      swim: computed(() =>
        makeStat(
          actor.value?.system.attributes.speed.otherSpeeds.find(
            (s: PF2eMovement) => s.type === 'swim'
          )
        )
      ),
      climb: computed(() =>
        makeStat(
          actor.value?.system.attributes.speed.otherSpeeds.find(
            (s: PF2eMovement) => s.type === 'climb'
          )
        )
      ),
      fly: computed(() =>
        makeStat(
          actor.value?.system.attributes.speed.otherSpeeds.find(
            (s: PF2eMovement) => s.type === 'fly'
          )
        )
      ),
      burrow: computed(() =>
        makeStat(
          actor.value?.system.attributes.speed.otherSpeeds.find(
            (s: PF2eMovement) => s.type === 'burrow'
          )
        )
      )
    },
    languages: computed(() => actor.value?.system?.details?.languages?.value)
  }
}
