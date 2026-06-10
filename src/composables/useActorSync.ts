import { onMounted, onUnmounted, watch, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { debounce } from 'lodash-es'
import type { TablemateCharacter } from '@/types/character-types'
import { sendCharacterRequest, setCharUnsynced, onActorFresh } from '@/api/characterSync'
import { setupSocketListenersForActor } from '@/api/socketSetup'
import { useUserStore } from '@/stores/user'
import { useSyncStatusStore } from '@/stores/syncStatus'
import { loadActorSnapshot } from '@/utils/actorCache'
import { logger } from '@/utils/utilities'

// Wires the lifecycle for keeping a local `actor` ref in sync with its
// Foundry-side counterpart: subscribes to socket events on mount, requests
// an initial fetch, and cleans up the subscription on unmount.
//
// On mount it also hydrates `actor` from the persisted IndexedDB snapshot so a
// reactivated PWA paints the sheet instantly instead of a spinner; the live
// fetch then refreshes it in place. While the stale snapshot is on screen the
// actor is flagged in the sync-status store (markStale), and cleared the moment
// fresh server data lands (markFresh) — the connection banner reads that to
// show a "Syncing…" hint for the active character.
//
// Refreshes are debounced (500ms leading-edge) so rapid back-to-back updates
// coalesce into one request.
export function useActorSync(
  characterId: string | undefined,
  actor: Ref<TablemateCharacter | undefined>
) {
  const { markStale, markFresh } = useSyncStatusStore()
  const debouncedRequest = debounce(sendCharacterRequest, 500, { leading: true })
  const requestCharacterDetails = async () => {
    if (!characterId) return
    setCharUnsynced(characterId, true)
    debouncedRequest(characterId)
  }

  let removeRefresh: (() => void) | undefined
  let removeFresh: (() => void) | undefined
  let stopUserIdWatch: (() => void) | undefined

  // (Visibility-return and reconnect refreshes are owned centrally — the
  // server-store session handler calls fireAllRefresh() on every re-auth,
  // which fans out to every actor registered here via addRefresh.)

  onMounted(() => {
    logger.info('TM-INIT: initiating character', characterId)
    if (!characterId) return

    // Paint last-known state immediately from disk, then mark it stale until
    // the live fetch confirms. Guard on `!actor.value` so we never clobber
    // fresh data that raced ahead of the async IDB read.
    const id = characterId
    removeFresh = onActorFresh(id, () => {
      markFresh(id)
    })
    void loadActorSnapshot(id).then((snapshot) => {
      if (snapshot && !actor.value) {
        actor.value = snapshot
        markStale(id)
      }
    })
    // Register the UPDATE_CHARACTER listener first, then send the initial
    // request. Sending before the listener is registered means the GM's
    // response can arrive on the socket with nothing to catch it.
    setupSocketListenersForActor(characterId, actor, requestCharacterDetails).then((cleanup) => {
      removeRefresh = cleanup
      // Also defer until userId is known — an empty userId causes the GM's
      // ownership check to reject the request as "unowned". On a fresh
      // post-login load the Foundry session event can arrive after the socket
      // connects, so userId may still be '' here.
      const { userId } = storeToRefs(useUserStore())
      if (userId.value) {
        sendCharacterRequest(characterId)
      } else {
        // This watch is created outside Vue's setup scope, so we track it
        // manually and clean it up in onUnmounted.
        stopUserIdWatch = watch(userId, (newId) => {
          if (!newId) return
          sendCharacterRequest(characterId)
          stopUserIdWatch?.()
          stopUserIdWatch = undefined
        })
      }
    })
  })

  onUnmounted(() => {
    logger.info('TM-INIT: unmounted actor', characterId)
    stopUserIdWatch?.()
    removeRefresh?.()
    removeFresh?.()
    // Don't leave a stale flag behind for an unmounted sheet.
    if (characterId) markFresh(characterId)
  })
}
