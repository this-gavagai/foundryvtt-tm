// Cross-client idempotency guard for TM requests, keyed by request uuid.
//
// Two Foundry clients can both believe they should execute a request during
// a proxy handoff: iAmProxyOrFallbackGM depends on each client's view of
// user.active at the instant a message arrives, and while the proxy's
// disconnect/reconnect propagates, the proxy and the fallback GM can each
// pass the gate. Executing twice is a real double mutation (spell slots,
// consumables, applied damage), not just a duplicate chat card.
//
// The guard uses traffic every client already sees: an answered request
// broadcasts an ACK carrying the request uuid on the module channel, and the
// serialized dispatch queue gives that ack time to arrive before a competing
// client starts the same request. A client skips a request whose uuid it has
// already seen answered (or started itself, which also absorbs duplicate
// deliveries). The window where both clients START simultaneously stays
// open — this shrinks the race; eliminating it would need a coordination
// protocol the module channel doesn't offer.

const RECENT_REQUEST_TTL_MS = 5 * 60 * 1000

// uuid → time first seen (started locally, or observed in another client's
// ack). Insert-only-if-absent keeps the map ordered by ascending timestamp,
// so pruning can stop at the first live entry; size stays bounded by the
// request rate within the TTL window.
const recentRequests = new Map<string, number>()

function prune(now: number) {
  for (const [uuid, seenAt] of recentRequests) {
    if (now - seenAt > RECENT_REQUEST_TTL_MS) recentRequests.delete(uuid)
    else break
  }
}

export function markRequestSeen(uuid: string, now = Date.now()): void {
  prune(now)
  if (!recentRequests.has(uuid)) recentRequests.set(uuid, now)
}

export function requestAlreadySeen(uuid: string, now = Date.now()): boolean {
  const seenAt = recentRequests.get(uuid)
  return seenAt !== undefined && now - seenAt <= RECENT_REQUEST_TTL_MS
}

export function resetRequestDedupForTest(): void {
  recentRequests.clear()
}
