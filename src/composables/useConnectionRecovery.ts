import { onBeforeUnmount } from 'vue'
import { useServerStore } from '@/stores/server'

// Mobile recovery: when the PWA returns from the background the socket may
// still report `connected` while the underlying transport is dead (NAT-binding
// expirations during sleep, wifi handoff while suspended). Probe with a short
// ack-bearing emit; if it doesn't round-trip, force a fresh socket so the user
// doesn't discover the staleness by tapping a roll that times out.
// `online`/`offline` are belt-and-suspenders for the case where the OS reports
// the network change before the app gets the visibility event.
// This is also the sole owner of visibility-triggered world refreshes — probing
// first ensures refreshWorld never fires on a stale socket.
export function useConnectionRecovery(): void {
  const { forceReconnect, probeConnection } = useServerStore()

  function reconnectQuietly() {
    void forceReconnect().catch(() => undefined)
  }

  function handleResumeProbe() {
    if (document.visibilityState !== 'visible') return
    void probeConnection()
      .then((alive) => {
        if (!alive) reconnectQuietly()
      })
      .catch(reconnectQuietly)
  }

  function handleOnline() {
    reconnectQuietly()
  }

  document.addEventListener('visibilitychange', handleResumeProbe)
  window.addEventListener('online', handleOnline)
  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', handleResumeProbe)
    window.removeEventListener('online', handleOnline)
  })
}
