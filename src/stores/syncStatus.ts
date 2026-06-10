import { reactive } from 'vue'
import { defineStore } from 'pinia'

// Tracks which actors are currently showing a cached (stale) snapshot from a
// prior session, before their first live payload has landed. Lifted out of the
// per-sheet `useActorSync` so the shared connection banner can surface a
// "Syncing…" state for the active character — mirroring how it reads
// `isConnected` for the "Reconnecting…" state.
export const useSyncStatusStore = defineStore('syncStatus', () => {
  const staleActors = reactive(new Set<string>())

  function markStale(actorId: string) {
    staleActors.add(actorId)
  }

  function markFresh(actorId: string) {
    staleActors.delete(actorId)
  }

  return { staleActors, markStale, markFresh }
})
