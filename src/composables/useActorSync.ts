import { onMounted, onUnmounted, type Ref } from 'vue'
import { debounce } from 'lodash-es'
import type { TablemateCharacter } from '@/types/character-types'
import { sendCharacterRequest, setCharUnsynced } from '@/api/characterSync'
import { setupSocketListenersForActor } from '@/api/socketSetup'
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
  onMounted(() => {
    logger.info('TM-INIT: initiating character', characterId)
    if (!characterId) return
    setupSocketListenersForActor(characterId, actor, requestCharacterDetails).then((cleanup) => {
      removeRefresh = cleanup
    })
    sendCharacterRequest(characterId)
    document.addEventListener('visibilitychange', onVisibilityChange)
  })
  onUnmounted(() => {
    logger.info('TM-INIT: unmounted actor', characterId)
    removeRefresh?.()
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })
}
