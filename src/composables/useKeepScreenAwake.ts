import { useWakeLock } from '@vueuse/core'

// Keep the screen awake during play (hard to tell if this is working or not).
// The request is deferred to the first click, which is the point the document
// is reliably visible and interacted with — a lock asked for any earlier is
// refused.
//
// A refusal is the case this is built around. Chrome on Android denies the lock
// outright while Battery Saver is on, which is a very likely state three hours
// into a session, and the denial is not permanent — the player plugs in, the
// saver switches off, and the next tap can have it. So the listener stays bound
// until a lock is actually held, rather than unbinding on the way to asking.
// vueuse cannot recover this on its own: it re-requests on visibility only when
// it has a sentinel to hear a `release` from, and a request that threw leaves
// none.
export function useKeepScreenAwake(): void {
  const { request, isSupported } = useWakeLock()
  // Nothing to retry on a browser without the API — without this, every tap for
  // the rest of the session would ask an absent navigator.wakeLock again.
  if (!isSupported.value) return

  // Taps land faster than the request settles, and two in flight would leave
  // the first sentinel orphaned — held, but no longer referenced, so nothing
  // can ever release it.
  let asking = false

  document.addEventListener(
    'click',
    async function enableNoSleep() {
      if (asking) return
      asking = true
      try {
        await request('screen')
      } catch {
        // Denied. Stay bound and try again on the next tap.
        return
      } finally {
        asking = false
      }
      document.removeEventListener('click', enableNoSleep, false)
    },
    false
  )
}
