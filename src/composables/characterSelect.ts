import { ref, watch, type Ref } from 'vue'
import type { ActorPF2e } from 'foundry-pf2e'
import { useWorld } from './world'
import { useSettings } from './settings'

const { world } = useWorld()
const { skipCharacterAlts } = useSettings()

const urlId = ref<string>()
const characterList = ref<string[]>([])
const activeCharacterId: Ref<string> = ref('')

export function useCharacterSelect(newUrlId: string | null = null) {
  if (newUrlId) {
    urlId.value = newUrlId
    activeCharacterId.value = newUrlId
  }
  watch(
    world,
    (newValue) => {
      const characterIds = new Set<string>()
      if (urlId.value) characterIds.add(urlId.value)
      if (skipCharacterAlts.value !== true) {
        newValue?.actors
          ?.filter((a: ActorPF2e) => a.ownership[newValue.userId] === 3)
          .forEach((a: ActorPF2e) => characterIds.add(a?._id ?? ''))
      }
      characterList.value = [...characterIds]
    },
    { immediate: true }
  )
  function setActiveCharacterId(newId: string | undefined) {
    if (newId) activeCharacterId.value = newId
  }
  return { characterList, activeCharacterId, setActiveCharacterId }
}
