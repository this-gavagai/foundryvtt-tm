import { ref, watch } from 'vue'
import type { World, Actor } from '@/types/pf2e-types'
import type { Ref } from 'vue'

const urlId = ref<string>()
const characterList = ref<string[]>([])

export function useCharacterSelect(
  newUrl: string | null = null,
  world: Ref<World | undefined> | null = null
) {
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
      },
      { immediate: true }
    )
  }
  return { characterList }
}
