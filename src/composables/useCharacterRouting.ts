import { watch, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useCharacterSelectStore } from '@/stores/characterSelect'

// Resolves which character is active from the URL (`?id=`) falling back to the
// last-used id in localStorage, seeds the character-select store, and keeps the
// URL + `lastCharacterId` in sync as the active character changes.
//
// Returns the reactive list/active id for view use, plus the initial `urlId`
// (used by dev tooling to identify the primary panel).
export function useCharacterRouting(): {
  urlId: string | null
  characterList: Ref<string[]>
  activeCharacterId: Ref<string>
} {
  const urlId =
    new URLSearchParams(document.location.search).get('id') ??
    localStorage.getItem('lastCharacterId')

  const characterSelectStore = useCharacterSelectStore()
  characterSelectStore.initialize(urlId)
  const { characterList, activeCharacterId } = storeToRefs(characterSelectStore)

  watch(activeCharacterId, (newValue) => {
    if (!newValue) return
    localStorage.setItem('lastCharacterId', newValue)
    const url = `${window.location.origin}/modules/tablemate/index.html?id=${newValue}`
    history.replaceState({}, '', url)
  })

  return { urlId, characterList, activeCharacterId }
}
