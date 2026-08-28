import { logger } from '@/utils/utilities'

// Backoff for automatic (non-user-initiated) reconnect attempts. Automatic
// failures never surface the ServerUrlGate — the cached sheet plus the
// reconnecting banner stay up while the policy retries quietly.
const RETRY_BACKOFF_BASE_MS = 1_000
const RETRY_BACKOFF_MAX_MS = 15_000

// The automatic-repair half of the connection machinery, extracted from the
// server store so its idempotency and backoff behavior can be tested without
// a live socket. The store injects `connect` (its own connectToServer) and
// `activeUrl` (the serverAddress store's single source of truth), so a server
// the user has left can never be silently reconnected to from a stale copy.
export function createReconnectPolicy(deps: {
  activeUrl: () => URL | undefined
  connect: (url: URL) => Promise<unknown>
}) {
  // `retryTimer` is the pending backoff wake-up; `reconnectInFlight` makes
  // requestReconnect idempotent so the several repair triggers (resume probe,
  // login page, watchdog, online event) can't stack teardowns on top of each
  // other.
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let consecutiveFailures = 0
  // Epoch-tagged so an attempt that cancel() abandoned cannot clear the slot a
  // newer one has since taken, and cannot be adopted by a later requester.
  let reconnectInFlight: { epoch: number; promise: Promise<void> } | undefined
  let attemptEpoch = 0

  function clearRetryTimer() {
    if (retryTimer === undefined) return
    clearTimeout(retryTimer)
    retryTimer = undefined
  }

  // The single automatic-repair entry point. Every trigger that wants a fresh
  // socket (resume probe, online event, login page's empty user list, stalled
  // handshakes) funnels through here: if a reconnect is already in flight the
  // existing attempt is shared instead of stacking a competing teardown, and a
  // pending backoff retry is promoted to "now".
  function requestReconnect(): Promise<void> {
    if (reconnectInFlight) return reconnectInFlight.promise
    const url = deps.activeUrl()
    if (!url) {
      logger.debug('TM-DIAG requestReconnect: no active server url')
      return Promise.resolve()
    }
    clearRetryTimer()
    logger.debug('TM-DIAG requestReconnect: re-establishing socket')
    const epoch = ++attemptEpoch
    const attempt = deps
      .connect(url)
      .then(() => undefined)
      // A failed automatic attempt has already scheduled its own backoff retry.
      .catch(() => undefined)
      .finally(() => {
        // Only while this attempt still owns the slot: cancel() may have
        // released it and a fresh attempt taken its place while this was out.
        if (reconnectInFlight?.epoch === epoch) reconnectInFlight = undefined
      })
    reconnectInFlight = { epoch, promise: attempt }
    return attempt
  }

  // Exponential backoff for automatic reconnects; runs until a connect
  // succeeds, the user picks a different server, or cancel() stops it.
  function scheduleRetry() {
    if (retryTimer !== undefined) return
    consecutiveFailures += 1
    const delay = Math.min(
      RETRY_BACKOFF_BASE_MS * 2 ** (consecutiveFailures - 1),
      RETRY_BACKOFF_MAX_MS
    )
    logger.debug('TM-DIAG scheduling reconnect', { attempt: consecutiveFailures, delayMs: delay })
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      if (!deps.activeUrl()) return
      void requestReconnect()
    }, delay)
  }

  // A successful session handshake (or a fresh attempt against a different
  // server) starts the backoff ladder over.
  function resetBackoff() {
    consecutiveFailures = 0
  }

  // Abandon the repair loop entirely: used when the user explicitly
  // disconnects, or signs out, and the state the in-flight attempt was started
  // against no longer holds.
  //
  // Releasing the in-flight slot is the point. Leaving it set would have the
  // next requestReconnect adopt the abandoned attempt instead of opening a
  // fresh socket — and that attempt read its session id before the caller
  // invalidated it, so what it establishes is exactly what cancel() was called
  // to be rid of. The attempt itself is left to settle into the void; the
  // store's epoch guard already makes its socket inert.
  function cancel() {
    clearRetryTimer()
    consecutiveFailures = 0
    attemptEpoch += 1
    reconnectInFlight = undefined
  }

  return { requestReconnect, scheduleRetry, clearRetryTimer, resetBackoff, cancel }
}
