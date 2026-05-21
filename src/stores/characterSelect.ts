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

  const ownedActorIds = computed<string[]>(
    () =>
      world.value?.actors
        ?.filter((a: ActorPF2e) => a.ownership?.[world.value!.userId] === 3)
        .map((a: ActorPF2e) => a?._id ?? '') ?? []
  )

  // Honor the URL/stored character only until we can verify ownership: while the
  // world is still loading we trust it, but once loaded it must be one the user
  // actually owns. This keeps a character whose permissions changed from
  // stranding the user on a "you don't own this" screen.
  const urlIdOwned = computed(
    () => !!urlId.value && (!world.value || ownedActorIds.value.includes(urlId.value))
  )

  const characterList = computed<string[]>(() => {
    const ids = new Set<string>()
    if (urlIdOwned.value) ids.add(urlId.value!)
    if (!skipCharacterAlts.value || !urlIdOwned.value) {
      ownedActorIds.value.forEach((id) => ids.add(id))
    }
    return [...ids]
  })

  // If the targeted character can no longer be seen by this user, drop it: fall
  // back to one of their own characters and revert the URL to the bare
  // index.html so the stale ?id= doesn't keep re-selecting the lost character.
  watch(
    urlIdOwned,
    (owned) => {
      if (owned || !urlId.value) return
      if (activeCharacterId.value === urlId.value) {
        activeCharacterId.value = ownedActorIds.value[0] ?? ''
      }
      history.replaceState({}, '', window.location.pathname)
    },
    { immediate: true }
  )

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
