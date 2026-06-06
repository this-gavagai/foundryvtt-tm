import { watchPostEffect, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useWorldStore } from '@/stores/world'
import { logger } from '@/utils/utilities'

// Shape of a CharacterSheet instance as exposed via defineExpose, narrowed to
// just the fields the debug hooks read off the `ref="characters"` array.
interface DebugPanel {
  actor?: { _id?: string }
  actorOrWorldActor?: { _id?: string }
  character?: unknown
}

// Dev-only: expose the active actor/character (and any alternates) plus the
// world on `window` for console poking. No-op in production builds.
export function useDevGlobals(
  characters: Readonly<Ref<unknown>>,
  urlId: string | null
): void {
  if (import.meta.env.MODE !== 'development') return

  const { world } = storeToRefs(useWorldStore())

  watchPostEffect(() => {
    const panels = characters.value as DebugPanel[] | null
    if (!panels || !Array.isArray(panels)) return
    window.altActors = new Map([])
    window.altCharacters = new Map([])
    panels.forEach((panel) => {
      if (panel?.actorOrWorldActor?._id === urlId) {
        window.actor = panel.actorOrWorldActor
        window.character = panel.character
      } else {
        window.altActors.set(panel?.actor?._id, panel?.actorOrWorldActor)
        window.altCharacters.set(panel?.actor?._id, panel?.character)
      }
    })
  })
  watchPostEffect(() => {
    if (world.value) {
      logger.info('TM-RECV world')
      window.world = world.value
    }
  })
}
