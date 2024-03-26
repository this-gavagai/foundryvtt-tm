import { ref, watch } from 'vue'

const urlId = ref<string>()
const characterList = ref<string[]>([])

export function useCharacterSelect(newUrl: string | null = null, world: any = null) {
  if (newUrl) urlId.value = newUrl
  if (world) {
    watch(
      world,
      (newValue, oldValue) => {
        let characters = new Set<string>()
        if (urlId.value) characters.add(urlId.value)
        newValue?.actors
          ?.filter((a: any) => a.ownership[newValue.userId] === 3)
          .forEach((a: any) => characters.add(a?._id))
        characterList.value = [...characters]
      },
      { immediate: true }
    )
  }
  return { characterList }
}
