import { onMounted, onUnmounted, watch, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { debounce } from 'lodash-es'
import type { TablemateCharacter } from '@/types/character-types'
import { sendCharacterRequest, setCharUnsynced } from '@/api/characterSync'
import { setupSocketListenersForActor } from '@/api/socketSetup'
import { useUserStore } from '@/stores/user'
import { logger } from '@/utils/utilities'

// Wires the lifecycle for keeping a local `actor` ref in sync with its
// Foundry-side counterpart: subscribes to socket events on mount, requests
// an initial fetch, and cleans up the subscription on unmount.
//
// Refreshes are debounced (500ms leading-edge) so rapid back-to-back updates
// coalesce into one request.
export function useActorSync(
  characterId: string | undefined,
  actor: Ref<TablemateCharacter | undefined>
) {
  const debouncedRequest = debounce(sendCharacterRequest, 500, { leading: true })
  const requestCharacterDetails = async () => {
    if (!characterId) return
    setCharUnsynced(characterId, true)
    debouncedRequest(characterId)
  }

  // Re-fetch character details when the tab comes back into focus, in case
  // we missed updates while backgrounded.
  function onVisibilityChange() {
    if (document.visibilityState === 'visible' && characterId) requestCharacterDetails()
  }

  let removeRefresh: (() => void) | undefined
  let stopUserIdWatch: (() => void) | undefined

  onMounted(() => {
    logger.info('TM-INIT: initiating character', characterId)
    if (!characterId) return
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
    document.addEventListener('visibilitychange', onVisibilityChange)
  })

  onUnmounted(() => {
    logger.info('TM-INIT: unmounted actor', characterId)
    stopUserIdWatch?.()
    removeRefresh?.()
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })
}
