import { reactive } from 'vue'
import { defineStore } from 'pinia'

// Tracks which actors are currently showing a cached (stale) snapshot from a
// prior session, before their first live payload has landed. Lifted out of the
// per-sheet `useActorSync` so the shared connection banner can surface a
// "Syncing…" state for the active character — mirroring how it reads
// `isConnected` for the "Reconnecting…" state.
export const useSyncStatusStore = defineStore('syncStatus', () => {
  const staleActors = reactive(new Set<string>())

  // Actors whose refresh has been ASKED FOR and not yet answered.
  //
  // Distinct from staleActors above, which means "painted from a cached
  // snapshot before the first live payload". This one covers the in-session
  // case: a direct socket write lands at the server immediately, but everything
  // PF2e DERIVES from it — AC, bulk, the strikes list, spell DCs — is recomputed
  // only when a GM's client answers the refresh the write fired. With no GM
  // listening that answer never comes, so the sheet keeps showing figures from
  // before the change with nothing to say so. See composables/useDerivedStale.
  const awaitingRefresh = reactive(new Set<string>())

  function markStale(actorId: string) {
    staleActors.add(actorId)
  }

  function markFresh(actorId: string) {
    staleActors.delete(actorId)
    awaitingRefresh.delete(actorId)
  }

  function markAwaitingRefresh(actorId: string) {
    awaitingRefresh.add(actorId)
  }

  return { staleActors, awaitingRefresh, markStale, markFresh, markAwaitingRefresh }
})
