import { computed, type Ref } from 'vue'
import type { Actor } from '@/types/pf2e-types'
import type { Field, WritableField } from './helpers'
import { type Modifier, makeModifiers } from './modifier'
import { useApi } from '../api'

export interface CharacterResources {
  hp: {
    current: WritableField<number>
    max: Field<number>
    temp: WritableField<number>
    modifiers: Field<Modifier[]>
  }
  heroPoints: {
    current: WritableField<number>
    max: Field<number>
  }
  focusPoints: {
    current: WritableField<number>
    max: Field<number>
  }
}

export function useCharacterResources(actor: Ref<Actor | undefined>) {
  const { updateActor } = useApi()
  return {
    hp: {
      current: computed({
        get: () => {
          console.log('calculating hitpoints') //log to test calc frequency
          return actor.value?.system?.attributes?.hp?.value
        },
        set: (newValue) => {
          actor.value!.system.attributes.hp.value = newValue
          const update = { system: { attributes: { hp: { value: newValue } } } }
          updateActor(actor, update)
        }
      }),
      max: computed(() => actor.value?.system?.attributes?.hp?.max),
      temp: computed({
        get: () => actor.value?.system?.attributes?.hp?.temp,
        set: (newValue) => {
          actor.value!.system.attributes.hp.temp = newValue
          const update = { system: { attributes: { hp: { temp: newValue } } } }
          updateActor(actor, update)
        }
      }),
      modifiers: computed(() => makeModifiers(actor.value?.system?.attributes?.hp?._modifiers))
    },
    heroPoints: {
      current: computed({
        get: () => actor.value?.system?.resources?.heroPoints?.value,
        set: (newValue) => {
          actor.value!.system.resources.heroPoints.value = newValue
          const update = { system: { resources: { heroPoints: { value: newValue } } } }
          updateActor(actor, update)
        }
      }),
      max: computed(() => actor.value?.system?.resources?.heroPoints?.max)
    },
    focusPoints: {
      current: computed({
        get: () => actor.value?.system?.resources?.focus?.value,
        set: (newValue) => {
          actor.value!.system.resources.focus.value = newValue
          const update = { system: { resources: { focus: { value: newValue } } } }
          updateActor(actor, update)
        }
      }),
      max: computed(() => actor.value?.system?.resources?.focus?.max)
    }
  }
}
