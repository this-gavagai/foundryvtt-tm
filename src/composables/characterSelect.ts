// TODO: alt chars aren't loading without gm
import { ref, watch, type Ref } from 'vue'
import type { Actor } from '@/types/pf2e-types'
import { useWorld } from './world'

const { world } = useWorld()

const urlId = ref<string>()
const characterList = ref<string[]>([])
const characterObjects: Ref<Actor[]> = ref([])

export function useCharacterSelect(newUrl: string | null = null) {
  if (newUrl) urlId.value = newUrl
  if (world) {
    watch(
      world,
      (newValue) => {
        const characters = new Set<string>()
        if (urlId.value) characters.add(urlId.value)
        newValue?.actors
          ?.filter((a: Actor) => a.ownership[newValue.userId] === 3)
          .forEach((a: Actor) => characters.add(a?._id))
        characterList.value = [...characters]
        characterObjects.value = characterList.value.map((c: string) =>
          world.value?.actors.find((a: Actor) => a._id === c)
        )
      },
      { immediate: true }
    )
  }
  return { characterList, characterObjects }
}
