import { ref, computed, watch } from 'vue'
import { defineStore, storeToRefs } from 'pinia'
import type { ActorPF2e } from '@7h3laughingman/pf2e-types'
import { useWorldStore } from '@/stores/world'
import { useSettingsStore } from '@/stores/settings'

export const useCharacterSelectStore = defineStore('characterSelect', () => {
  const { world } = storeToRefs(useWorldStore())
  const { skipCharacterAlts } = storeToRefs(useSettingsStore())

  const urlId = ref<string>()
  const activeCharacterId = ref<string>('')

  const characterList = computed<string[]>(() => {
    const ids = new Set<string>()
    if (urlId.value) ids.add(urlId.value)
    if (!skipCharacterAlts.value) {
      world.value?.actors
        ?.filter((a: ActorPF2e) => a.ownership[world.value!.userId] === 3)
        .forEach((a: ActorPF2e) => ids.add(a?._id ?? ''))
    }
    return [...ids]
  })

  // Auto-default to the first character when the list materializes
  watch(
    characterList,
    (list) => {
      if (!activeCharacterId.value && list.length > 0) activeCharacterId.value = list[0]
    },
    { immediate: true }
  )

  function initialize(newUrlId: string | null) {
    if (newUrlId) {
      urlId.value = newUrlId
      activeCharacterId.value = newUrlId
    }
  }

  function setActiveCharacterId(newId: string | undefined) {
    if (newId) activeCharacterId.value = newId
  }

  return {
    urlId,
    characterList,
    activeCharacterId,
    initialize,
    setActiveCharacterId
  }
})
