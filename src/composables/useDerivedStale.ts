import { computed, type ComputedRef, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useListenersStore } from '@/stores/listenersOnline'
import { useSyncStatusStore } from '@/stores/syncStatus'

// Whether a figure the GM computes is currently behind what the server holds.
//
// The app writes most of the sheet DIRECTLY over the modifyDocument socket, as
// its own Foundry user, and that is the point: no GM need be online. But a
// direct write is GM-free for the WRITE and not for its consequences. What the
// app holds is source data plus a handful of overlays; everything genuinely
// derived — AC, bulk and encumbrance, `system.actions`, spell DCs, rune-adjusted
// item levels and prices — is computed by PF2e on a real client and only
// refreshed when the elected GM answers a REQUEST_CHARACTER.
//
// So: equip armour with no GM online and the item write lands on the server
// while the AC on screen does not move. The plumbing to recover has been there
// all along (fireRefresh, the LISTENER_ONLINE re-fetch), and the connection
// state is surfaced in the side menu as `no-gm` — but nothing said that THIS
// NUMBER is one of the things waiting, so the gap read as a bug rather than as
// the honest limit of the direct path.
//
// Both halves of the condition are load-bearing:
//
//   * a refresh is outstanding (syncStatus.awaitingRefresh). Without it a sheet
//     that has simply been sitting there with the GM away would mark everything
//     stale, which is false — those figures are correct as of the last payload;
//   * no listener. With a GM online the answer arrives in a fraction of a
//     second, and flickering a marker on every write would be worse than
//     saying nothing.
export function useDerivedStale(actorId: Ref<string | undefined>): ComputedRef<boolean> {
  const syncStatus = useSyncStatusStore()
  const { isListening } = storeToRefs(useListenersStore())

  return computed(() => {
    const id = actorId.value
    if (!id) return false
    return !isListening.value && syncStatus.awaitingRefresh.has(id)
  })
}
