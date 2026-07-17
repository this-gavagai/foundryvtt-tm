import { computed, type Ref } from 'vue'
import type { CharacterPF2e } from '@7h3laughingman/pf2e-types'
import type { Field, WritableField } from './helpers'
import { type Modifier, makeModifiers } from './defs/modifier'
import { updateActor } from '@/api/documents'

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

export function useCharacterResources(actor: Ref<CharacterPF2e | undefined>): CharacterResources {
  const hp = {
    current: computed({
      get: () => {
        return actor.value?.system?.attributes?.hp?.value
      },
      set: (newValue) => {
        actor.value!.system.attributes.hp.value = newValue!
        const update = { system: { attributes: { hp: { value: newValue } } } }
        // Fire-and-forget: recovery (refresh + rethrow) happens in updateActor.
        updateActor(actor, update).catch(() => {})
      }
    }),
    max: computed(() => actor.value?.system?.attributes?.hp?.max),
    temp: computed({
      get: () => actor.value?.system?.attributes?.hp?.temp,
      set: (newValue) => {
        actor.value!.system.attributes.hp.temp = newValue!
        const update = { system: { attributes: { hp: { temp: newValue } } } }
        updateActor(actor, update).catch(() => {})
      }
    }),
    modifiers: computed(() => makeModifiers(actor.value?.system?.attributes?.hp?.modifiers))
  }
  const heroPoints = {
    current: computed({
      get: () => actor.value?.system?.resources?.heroPoints?.value,
      set: (newValue) => {
        actor.value!.system.resources.heroPoints.value = newValue!
        const update = { system: { resources: { heroPoints: { value: newValue } } } }
        updateActor(actor, update).catch(() => {})
      }
    }),
    max: computed(() => actor.value?.system?.resources?.heroPoints?.max)
  }
  const focusPoints = {
    current: computed({
      get: () => actor.value?.system?.resources?.focus?.value,
      set: (newValue) => {
        actor.value!.system.resources.focus.value = newValue!
        const update = { system: { resources: { focus: { value: newValue } } } }
        updateActor(actor, update).catch(() => {})
      }
    }),
    max: computed(() => actor.value?.system?.resources?.focus?.max)
  }

  return {
    hp,
    heroPoints,
    focusPoints
  }
}
