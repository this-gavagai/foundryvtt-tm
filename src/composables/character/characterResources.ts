import { computed, type Ref } from 'vue'
import type { CharacterPF2e } from '@7h3laughingman/pf2e-types'
import type { Field, WritableField } from './helpers'
import { type Modifier, makeModifiers } from './defs/modifier'
import { updateActor } from '@/api/documents'
import { setHitPoints, type HitPointTarget } from '@/composables/setHitPoints'

export interface CharacterResources {
  hp: {
    current: Field<number>
    max: Field<number>
    temp: Field<number>
    modifiers: Field<Modifier[]>
    // Hit points are written through one combined call rather than per-field
    // setters: the change is handed to the GM's client so the preUpdateActor
    // hooks that drive condition automation run, and they have to see the whole
    // edit at once. See composables/setHitPoints.ts.
    set: (target: HitPointTarget) => Promise<unknown>
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
    current: computed(() => actor.value?.system?.attributes?.hp?.value),
    max: computed(() => actor.value?.system?.attributes?.hp?.max),
    temp: computed(() => actor.value?.system?.attributes?.hp?.temp),
    modifiers: computed(() => makeModifiers(actor.value?.system?.attributes?.hp?.modifiers)),
    set: (target: HitPointTarget) => setHitPoints(actor, target)
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
