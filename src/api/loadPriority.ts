// Initial-load request ordering.
//
// On a cold start every owned character's sheet mounts at once (App.vue keeps
// all TabPanels mounted), and each fires its own initial requestCharacterDetails
// independently. The world request fires separately at app setup. Left
// uncoordinated they all flood the GM's socket at the same time, and since the
// GM serializes actor payloads one at a time the *visible* sheet can end up
// queued behind several background characters.
//
// This module gates the *initial* request of non-active sheets behind two
// signals — the active character's request having been sent, and the world
// request having gone out — so the GM processes them in the order:
//   active character -> world -> other characters.
//
// Only the first (cold-load) request is gated; refreshes go out immediately.
// A hard timeout guarantees background sheets never hang if a signal never
// fires (e.g. the active sheet isn't in the owned list, or the world request
// fails) — they just fall back to firing in parallel as before.

const FALLBACK_TIMEOUT_MS = 5000

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

const activeRequested = deferred()
const worldRequested = deferred()

// Resolves once both higher-priority requests are out, or after the fallback
// timeout — whichever comes first. Background sheets await this before their
// initial emit.
const priorReady: Promise<void> = Promise.race([
  Promise.all([activeRequested.promise, worldRequested.promise]).then(() => undefined),
  new Promise<void>((resolve) => setTimeout(resolve, FALLBACK_TIMEOUT_MS))
])

/** Called by the active character's sheet once its initial request is sent. */
export function markActiveRequestSent(): void {
  activeRequested.resolve()
}

/** Called by the world store once the world request has been emitted. */
export function markWorldRequestSent(): void {
  worldRequested.resolve()
}

/**
 * Awaited by a non-active sheet before its initial request, so it slots in
 * behind the active character and the world. Resolves immediately once those
 * are out (or after a fallback timeout).
 */
export function waitForPriorRequests(): Promise<void> {
  return priorReady
}
