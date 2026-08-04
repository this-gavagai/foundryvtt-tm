import { ref, computed, watch } from 'vue'
import { defineStore, storeToRefs } from 'pinia'
import type { ActorPF2e } from '@7h3laughingman/pf2e-types'
import { useWorldStore } from '@/stores/world'
import { useSettingsStore } from '@/stores/settings'
import { getLastCharacterId } from '@/utils/utilities'
import { collectionToArray, type CollectionLike } from '@/utils/foundryCollections'

// Actor types a GM's list is limited to. A player's list is whatever the GM
// gave them ownership of, so it stays unfiltered (bar the party actor); a GM
// owns *every* actor in the world, and each entry here mounts a CharacterSheet
// that pulls a full actor payload — so pulling in every npc/loot/hazard would
// be both expensive and useless, since only these two have a sheet to render.
const GM_SHEET_TYPES = new Set(['character', 'familiar'])

export const useCharacterSelectStore = defineStore('characterSelect', () => {
  const { world, currentUserIsGM } = storeToRefs(useWorldStore())
  const { skipCharacterAlts } = storeToRefs(useSettingsStore())

  const urlId = ref<string>()
  const activeCharacterId = ref<string>('')
  const activeSheetTab = ref<number>()

  // The actors this user may open. GMs are owners of everything in Foundry's
  // model and are almost never listed in an actor's ownership map, so reading
  // that map literally would leave them with no characters at all.
  const availableActorIds = computed<string[]>(() => {
    if (!world.value) return []
    return collectionToArray<ActorPF2e>(world.value.actors as CollectionLike<ActorPF2e>)
      .filter((a: ActorPF2e) =>
        currentUserIsGM.value
          ? GM_SHEET_TYPES.has(a.type)
          : a.ownership?.[world.value!.userId] === 3 && a.type !== 'party'
      )
      .map((a: ActorPF2e) => a?._id ?? '')
  })

  // Honor the URL/stored character only until we can verify access: while the
  // world is still loading we trust it, but once loaded it must be one the user
  // can actually open. This keeps a character whose permissions changed from
  // stranding the user on a "you don't own this" screen.
  const urlIdAvailable = computed(
    () => !!urlId.value && (!world.value || availableActorIds.value.includes(urlId.value))
  )

  const characterList = computed<string[]>(() => {
    const ids = new Set<string>()
    if (urlIdAvailable.value) ids.add(urlId.value!)
    if (!skipCharacterAlts.value || !urlIdAvailable.value) {
      availableActorIds.value.forEach((id) => ids.add(id))
    }
    return [...ids]
  })

  // If the targeted character can no longer be seen by this user, drop it: fall
  // back to one of their own characters and revert the URL to the bare
  // index.html so the stale ?id= doesn't keep re-selecting the lost character.
  watch(
    urlIdAvailable,
    (available) => {
      if (available || !urlId.value) return
      if (activeCharacterId.value === urlId.value) {
        activeCharacterId.value = availableActorIds.value[0] ?? ''
      }
      history.replaceState({}, '', window.location.pathname)
    },
    { immediate: true }
  )

  // Auto-default when the list materializes: prefer the last saved character
  // over the first in the list, so selection survives a world reload cycle.
  watch(
    characterList,
    (list) => {
      if (!activeCharacterId.value && list.length > 0) {
        const saved = getLastCharacterId()
        activeCharacterId.value = saved && list.includes(saved) ? saved : list[0]
      }
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

  // Select nothing, and drop the deep-linked `?id=` so it can't re-select on
  // the next evaluation. Used when the loaded server's characters stop being
  // ours to show (sign-out, forgetting the server): an empty selection empties
  // characterList, which unmounts the sheets — the only way the actor data they
  // hold in memory actually goes away.
  function clearSelection() {
    activeSheetTab.value = undefined
    urlId.value = undefined
    activeCharacterId.value = ''
    if (new URLSearchParams(window.location.search).has('id')) {
      history.replaceState({}, '', window.location.pathname)
    }
  }

  // Re-point the selection at the *new* server after a switch. The previous
  // server's active character (and deep-linked `?id=`) must not carry over, so
  // we reseed from this server's own remembered character (scoped per origin —
  // the caller updates serverUrl before calling this). Seeding it up front lets
  // that character's cached snapshot paint immediately rather than waiting for
  // the new world to load; the activeCharacterId watch in useCharacterRouting
  // then syncs the URL/storage. If the server has no remembered character we
  // clear the selection (and the stale `?id=`) and let the character-list watch
  // default to an owned character once the world arrives.
  function reseedForCurrentServer() {
    const remembered = getLastCharacterId()
    if (!remembered) {
      clearSelection()
      return
    }
    activeSheetTab.value = undefined
    urlId.value = remembered
    activeCharacterId.value = remembered
  }

  function initializeActiveSheetTab(defaultIndex: number) {
    activeSheetTab.value ??= defaultIndex
  }

  function setActiveSheetTab(newIndex: number) {
    activeSheetTab.value = newIndex
  }

  return {
    urlId,
    characterList,
    activeCharacterId,
    activeSheetTab,
    initialize,
    setActiveCharacterId,
    clearSelection,
    reseedForCurrentServer,
    initializeActiveSheetTab,
    setActiveSheetTab
  }
})
