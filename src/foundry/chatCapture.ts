// Request-uuid ↔ chat-message correlation.
//
// Several PF2e roll pipelines (inline @Damage / @Check click handling, the
// reroll flow) create their chat message internally and never return it. To
// read back the produced roll, a handler registers a capture keyed by its
// request uuid *before* triggering the roll. The listener stamps that uuid onto
// the message during preCreateChatMessage (via the chat-origin stack) and, once
// the message exists, calls resolveCapture() from the single createChatMessage
// hook.
//
// Matching on the request uuid — rather than grabbing the globally-next message
// with Hooks.once, as the previous per-handler code did — stops an interleaved
// tablemate request, the GM typing in chat, or a late message from a prior
// request from being mistaken for this request's result.

import type { OutcomeFlags } from './utils/rollOutcome'

// `flags` is carried so a handler can describe what the roll was aimed at and
// how it came out (utils/rollOutcome.ts) from the same message it takes the id
// off — PF2e writes both onto the card and nowhere else.
export type CapturedMessage = {
  id?: string | null
  _id?: string | null
  rolls?: unknown[]
  flags?: OutcomeFlags | null
}

const captures = new Map<string, (msg: CapturedMessage | undefined) => void>()

const DEFAULT_CAPTURE_TIMEOUT_MS = 5000

// Register interest in the chat message produced by this request. Resolves with
// the message once it's created, or with undefined if none arrives before the
// timeout (e.g. the roll pipeline bailed out silently on an unparsable formula).
export function registerCapture(
  uuid: string,
  timeoutMs = DEFAULT_CAPTURE_TIMEOUT_MS
): Promise<CapturedMessage | undefined> {
  return new Promise((resolve) => {
    const settle = (msg: CapturedMessage | undefined) => {
      globalThis.clearTimeout(timer)
      // Only clear our own entry — a later capture may have reused the uuid.
      if (captures.get(uuid) === settle) captures.delete(uuid)
      resolve(msg)
    }
    const timer = globalThis.setTimeout(() => settle(undefined), timeoutMs)
    captures.set(uuid, settle)
  })
}

// Answer a still-pending capture NOW, with nothing.
//
// For callers whose message — if the request produced one at all — already
// exists by the time they ask: awaiting the promise itself would otherwise sit
// out the full timeout on a request that posted nothing, delaying an ack the
// caller could have sent immediately. A capture that already resolved is gone
// from the map, so this is a no-op on the happy path and the awaited promise
// still yields its message.
export function settleCapture(uuid: string): void {
  captures.get(uuid)?.(undefined)
}

// Called by the listener's createChatMessage hook with the uuid stamped onto the
// newly created message. No-op when no capture is waiting on that uuid.
export function resolveCapture(uuid: string, msg: CapturedMessage): void {
  captures.get(uuid)?.(msg)
}
