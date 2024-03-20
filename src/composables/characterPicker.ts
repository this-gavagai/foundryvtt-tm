import { ref, computed, watch } from 'vue'

const urlId = ref<string>()
const activeIndex = ref<number>(0)
const characterList = ref<string[]>([])

function pickCharacter(newId: string) {
  activeIndex.value = characterList.value.indexOf(newId)
}

export function useCharacterPicker(newUrl: string | null = null, newWorld: any = null) {
  if (newUrl) urlId.value = newUrl
  // if (newWorld) world.value = newWorld.value
  if (newWorld) {
    watch(
      newWorld,
      (newValue, oldValue) => {
        console.log('we changed the world')
        let characters = new Set<string>()
        if (urlId.value) characters.add(urlId.value)
        newValue?.actors
          ?.filter((a: any) => a.ownership[newValue.userId] === 3)
          .forEach((a: any) => characters.add(a._id))
        // console.log('us', [...characters])
        characterList.value = [...characters]
      },
      { immediate: true }
    )
  }
  return { characterList, activeIndex, pickCharacter }
}
