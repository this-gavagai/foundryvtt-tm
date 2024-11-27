// todo: is there a better way to do a complex object with many computed properties?
import type { Ref, ComputedRef, WritableComputedRef } from 'vue'
import { computed, watch } from 'vue'
import type { Actor, Modifier, Item } from '@/types/pf2e-types'
import { useApi } from '@/composables/api'

export interface Character {
  ancestry: ComputedRef<Item | undefined>
  heritage: ComputedRef<Item | undefined>
  background: ComputedRef<Item | undefined>
  classType: ComputedRef<Item | undefined>
  level: ComputedRef<number | undefined>
  xp: {
    current: WritableComputedRef<number | undefined>
    max: ComputedRef<number | undefined>
  }
  hp: {
    current: WritableComputedRef<number | undefined>
    max: ComputedRef<number | undefined>
    temp: WritableComputedRef<number | undefined>
    modifiers: ComputedRef<Modifier[]>
  }
  heroPoints: {
    current: WritableComputedRef<number | undefined>
    max: ComputedRef<number | undefined>
  }
  ac: {
    current: ComputedRef<number | undefined>
    modifiers: ComputedRef<Modifier[]>
  }
}

export function useCharacter(actor: Ref<Actor | undefined>) {
  watch(actor, () => console.log('actor changed', actor.value?._id))
  const { updateActor } = useApi()
  const character: Character = {
    ancestry: computed(() => actor?.value?.items?.find((x: Item) => x.type === 'ancestry')),
    background: computed(() => actor?.value?.items?.find((x: Item) => x.type === 'background')),
    heritage: computed(() => actor?.value?.items?.find((x: Item) => x.type === 'heritage')),
    classType: computed(() => actor?.value?.items?.find((x: Item) => x.type === 'class')),
    level: computed(() => actor?.value?.system?.details?.level?.value),
    xp: {
      current: computed({
        get: () => actor?.value?.system?.details?.xp?.value,
        set: (newValue) => {
          actor.value!.system.details.xp.value = newValue
          const update = { system: { details: { xp: { value: newValue } } } }
          updateActor(actor, update)
        }
      }),
      max: computed(() => actor?.value?.system?.details?.xp?.max)
    },
    hp: {
      current: computed({
        get: () => {
          console.log('calculating hitpoints') //log to test calc frequency
          return actor?.value?.system?.attributes?.hp?.value
        },
        set: (newValue) => {
          actor.value!.system.attributes.hp.value = newValue
          const update = { system: { attributes: { hp: { value: newValue } } } }
          updateActor(actor, update)
        }
      }),
      max: computed(() => actor?.value?.system?.attributes?.hp?.max),
      temp: computed({
        get: () => actor?.value?.system?.attributes?.hp?.temp,
        set: (newValue) => {
          actor.value!.system.attributes.hp.temp = newValue
          const update = { system: { attributes: { hp: { temp: newValue } } } }
          updateActor(actor, update)
        }
      }),
      modifiers: computed(() => actor?.value?.system?.attributes?.hp?._modifiers)
    },
    heroPoints: {
      current: computed({
        get: () => actor?.value?.system?.resources?.heroPoints?.value,
        set: (newValue) => {
          actor.value!.system.resources.heroPoints.value = newValue
          const update = { system: { resources: { heroPoints: { value: newValue } } } }
          updateActor(actor, update)
        }
      }),
      max: computed(() => actor?.value?.system?.resources?.heroPoints?.max)
    },
    ac: {
      current: computed(() => actor?.value?.system?.attributes?.ac?.value),
      modifiers: computed(() => actor?.value?.system?.attributes?.ac?.modifiers)
    }
  }
  window.character = character
  return { character }
}