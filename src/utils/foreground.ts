// Run `handler` whenever the app comes back to the foreground.
//
// Every background store that keeps a picture of the world's live state needs
// this, for the same reason: a backgrounded tab or app stops receiving pushes
// (mobile browsers throttle timers; iOS suspends the socket outright), so
// whatever it holds on resume is only as fresh as the moment it went away — and
// nothing downstream can tell, because the stale data still looks valid.
//
// Returns the unsubscribe, so a caller's own disposal stays a single call.
export function onForeground(handler: () => void): () => void {
  const listener = () => {
    if (document.visibilityState === 'visible') handler()
  }
  document.addEventListener('visibilitychange', listener)
  return () => document.removeEventListener('visibilitychange', listener)
}
