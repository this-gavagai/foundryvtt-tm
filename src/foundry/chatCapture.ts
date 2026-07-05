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

export type CapturedMessage = { rolls?: unknown[] }

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

// Called by the listener's createChatMessage hook with the uuid stamped onto the
// newly created message. No-op when no capture is waiting on that uuid.
export function resolveCapture(uuid: string, msg: CapturedMessage): void {
  captures.get(uuid)?.(msg)
}
