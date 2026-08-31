// Which Tablemate request a chat message belongs to.
//
// The Foundry side creates chat messages as a side effect of running a handler:
// PF2e's roll pipelines post their own cards and mostly don't hand them back. So
// while a handler runs, its request sits on a stack here, and the listener's
// preCreateChatMessage hook asks this module what to stamp on each message being
// created. Three fields, read for three different things — see chatOriginStampFor.
//
// Split out of listener.ts so the two decisions with correctness consequences
// (which message carries the capture key, and what happens to a request the
// dispatch queue abandons) are unit-testable without a Foundry client.

export type ChatOrigin = {
  // The tablet user the request came from. Drives display attribution.
  userId: string
  // The request's own uuid. This is the capture key: whichever message carries it
  // is handed back to the app as "your roll" (see chatCapture.ts).
  uuid?: string
  // Set when the request's dice faces were player-determined (manual picker /
  // Pixel dice) under the 'flag' policy, so the card gets tagged.
  manualRoll?: boolean
  // The actor the request is about, used to scope the uuid stamp to the message
  // this request itself produces. See belongsToRequest.
  actorId?: string
  // Set when the dispatch queue gave up waiting: the handler may still be
  // running, but nothing it does may influence anything any more.
  abandoned?: boolean
}

// The speaker fields of a message-in-progress, which reaches the
// preCreateChatMessage hook either as a document or as raw source data.
export type PendingMessage = { speaker?: { actor?: string | null } | null }

// What to write into flags.tablemate on a message being created.
export type ChatOriginStamp = {
  originUserId: string
  originUuid?: string
  manualRoll?: true
}

// How long after a handler settles its attribution still applies. PF2e emits
// follow-up messages just after the call that produced the roll returns, and
// those belong to the same player.
export const CHAT_ORIGIN_GRACE_MS = 2000

const chatOriginStack: ChatOrigin[] = []
let recentChatOrigin: { userId: string; expiresAt: number } | undefined

export function currentChatOrigin(): ChatOrigin | undefined {
  return chatOriginStack[chatOriginStack.length - 1]
}

// The user a message created right now is attributed to: the live request if
// there is one, else a request that settled within the grace window.
export function currentChatOriginUserId(now = Date.now()): string | undefined {
  const stacked = currentChatOrigin()?.userId
  if (stacked) return stacked

  if (!recentChatOrigin) return undefined
  if (recentChatOrigin.expiresAt > now) return recentChatOrigin.userId
  recentChatOrigin = undefined
  return undefined
}

export function pendingMessageOf(message: unknown, data: unknown): PendingMessage {
  const fromDocument = (message ?? {}) as PendingMessage
  const fromData = (data ?? {}) as PendingMessage
  return { speaker: fromDocument.speaker ?? fromData.speaker }
}

// Whether this message is plausibly the one the request is producing, rather than
// something else created while the request happened to be in flight.
//
// This gates the uuid stamp, and the uuid is what resolveCapture matches on — so
// whichever message carries it is returned to the app as its roll. Stamping the
// FIRST message created during the handler's window is wrong: that window is
// precisely when PF2e and GM-side automation modules emit messages of their own
// (an applied-effect card, a module's follow-up), and the first one through the
// door claimed the capture. The app could be handed a card that is not its roll,
// or the real card could arrive with the capture already settled.
//
// Match on the speaker's actor, which every capture-using path sets to the
// request's own actor: the inline @Damage card, the inline @Check card, the reroll
// replacement (built from the original message, whose actor the handler already
// verified), and the spell card. handlers/castSpell.ts uses the same predicate as
// the fallback for its own cast-target stamping.
//
// A message with no speaker actor is not matched: the capture then times out and
// the handler reports no roll, which is the honest answer and much better than a
// confidently wrong one. Narrowing further — a module posting for the SAME actor
// mid-request — would need per-path knowledge this stack doesn't have.
export function belongsToRequest(origin: ChatOrigin, pending: PendingMessage): boolean {
  if (!origin.actorId) return false
  return !!pending.speaker?.actor && pending.speaker.actor === origin.actorId
}

// The flags to stamp on a message being created right now, or undefined when this
// message has no Tablemate origin at all.
//
// Each field is scoped differently, because each is read for something different:
//
//   originUserId  display attribution. Honours the grace window deliberately, so
//                 PF2e's follow-up messages show as the player's too.
//   manualRoll    the "player-determined dice" tag. Broad like originUserId: a
//                 spurious tag on a neighbouring card is a smaller failure than a
//                 manual roll going untagged, which is the whole point of the
//                 world's manual-roll policy.
//   originUuid    the capture key, which decides which message is returned to the
//                 app as its roll. Scoped to the request's own message.
export function chatOriginStampFor(
  message: unknown,
  data: unknown,
  now = Date.now()
): ChatOriginStamp | undefined {
  const originUserId = currentChatOriginUserId(now)
  if (!originUserId) return undefined

  const origin = currentChatOrigin()
  const stamp: ChatOriginStamp = { originUserId }
  if (origin?.manualRoll) stamp.manualRoll = true
  if (origin?.uuid && belongsToRequest(origin, pendingMessageOf(message, data))) {
    stamp.originUuid = origin.uuid
  }
  return stamp
}

// Remove a frame by identity, not the top one by position.
//
// Frames normally settle LIFO, but not always: when the dispatch queue abandons a
// hung handler the next request starts while the hung one is still running, so a
// positional pop would discard the frame of whichever request is executing NOW.
function dropChatOrigin(origin: ChatOrigin): number {
  const index = chatOriginStack.lastIndexOf(origin)
  if (index < 0) return 0
  chatOriginStack.splice(index, 1)
  return 1
}

// Tear down a request the dispatch queue gave up on.
//
// Advancing the queue past a handler that is still running gives up the
// serialization that keeps ambient state from leaking between requests, so the
// abandoned request's frame has to come off here rather than waiting for a
// `finally` that may never run — otherwise it stays on the stack and keeps
// stamping its userId (and claiming captures) on other requests' messages.
//
// Returns how many frames it dropped (1, or 0 if the handler had already
// settled) so it reports like the other teardowns the dispatch timeout runs —
// see requestTeardown.ts.
export function abandonChatOrigin(origin: ChatOrigin): number {
  origin.abandoned = true
  return dropChatOrigin(origin)
}

function retainRecentChatOrigin(originUserId: string, now = Date.now()) {
  recentChatOrigin = { userId: originUserId, expiresAt: now + CHAT_ORIGIN_GRACE_MS }
  globalThis.setTimeout(() => {
    if (recentChatOrigin?.userId === originUserId && recentChatOrigin.expiresAt <= Date.now()) {
      recentChatOrigin = undefined
    }
  }, CHAT_ORIGIN_GRACE_MS)
}

export async function withChatOrigin<T>(origin: ChatOrigin, run: () => Promise<T>): Promise<T> {
  chatOriginStack.push(origin)
  try {
    return await run()
  } finally {
    dropChatOrigin(origin)
    // An abandoned request must not open a grace window on its way out. Its
    // handler can settle minutes after the queue moved on, and the two seconds
    // that follow belong to whatever is running now — not to a request whose
    // requester timed out long ago.
    if (!origin.abandoned) retainRecentChatOrigin(origin.userId)
  }
}

export function resetChatOriginForTest(): void {
  chatOriginStack.length = 0
  recentChatOrigin = undefined
}
