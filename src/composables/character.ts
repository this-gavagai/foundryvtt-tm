// todo: is there a better way to do a complex object with many computed properties?
import { type Ref, type ComputedRef, computed } from 'vue'
import type { Actor, Modifier } from '@/types/pf2e-types'
import { useApi } from '@/composables/api'

export interface Character {
  hp: {
    current: ComputedRef<Number | null>
    max: ComputedRef<Number | null>
    temp: ComputedRef<Number | null>
    modifiers: ComputedRef<Modifier[]>
  }
}

export function useCharacter(actor: Ref<Actor>) {
  const { updateActor } = useApi()
  const character: Character = {
    hp: {
      current: computed({
        get() {
          return actor?.value?.system?.attributes?.hp?.value
        },
        set(newValue) {
          actor.value.system.attributes.hp.value = newValue
          updateActor(actor, { system: { attributes: { hp: { value: newValue } } } })
        }
      }),
      max: computed(() => {
        return actor?.value?.system?.attributes?.hp?.max
      }),
      temp: computed({
        get() {
          return Number(actor?.value?.system?.attributes?.hp?.temp)
        },
        set(newValue) {
          actor.value.system.attributes.hp.temp = newValue
          updateActor(actor, { system: { attributes: { hp: { temp: newValue } } } })
        }
      }),
      modifiers: computed(() => {
        return actor?.value?.system?.attributes?.hp?._modifiers
      })
    }
  }
  window.character = character
  return { character }
}
