import { ref, watch, inject } from 'vue'
import type { World, Actor } from '@/types/pf2e-types'
import type { Ref } from 'vue'
import { useKeys } from '@/composables/injectKeys'
import { useWorld } from './world'

const { world } = useWorld()

const urlId = ref<string>()
const characterList = ref<string[]>([])
const characterObjects: any = ref([])

export function useCharacterSelect(newUrl: string | null = null) {
  if (newUrl) urlId.value = newUrl
  if (world) {
    watch(
      world,
      (newValue, oldValue) => {
        let characters = new Set<string>()
        if (urlId.value) characters.add(urlId.value)
        newValue?.actors
          ?.filter((a: Actor) => a.ownership[newValue.userId] === 3)
          .forEach((a: Actor) => characters.add(a?._id))
        characterList.value = [...characters]
        characterObjects.value = characterList.value.map(
          (c: string) => world.value?.actors.find((a: Actor) => a._id === c)
        )
      },
      { immediate: true }
    )
  }
  return { characterList, characterObjects }
}
