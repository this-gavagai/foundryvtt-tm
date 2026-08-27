import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  CHAT_ORIGIN_GRACE_MS,
  abandonChatOrigin,
  belongsToRequest,
  chatOriginStampFor,
  currentChatOrigin,
  currentChatOriginUserId,
  pendingMessageOf,
  resetChatOriginForTest,
  withChatOrigin,
  type ChatOrigin
} from '@/foundry/chatOrigin'

// While a handler runs, PF2e posts its cards as a side effect and mostly doesn't
// hand them back — so a request's identity has to be recovered from whatever
// messages appear. These tests pin the two decisions with consequences:
//
//   1. which message carries the capture key, and so gets returned to the app as
//      "your roll" (a neighbouring message claiming it means the app is handed a
//      card that isn't its roll, or the real card arrives too late);
//   2. what happens to a request the dispatch queue abandoned — its frame must
//      stop influencing everything else, immediately and permanently.

const origin = (fields: Partial<ChatOrigin> = {}): ChatOrigin => ({
  userId: 'usr-1',
  uuid: 'req-1',
  actorId: 'act-1',
  ...fields
})

// A message-in-progress as the preCreateChatMessage hook sees it. Foundry hands
// the hook a document; some creation paths carry the speaker only on raw source.
const asDocument = (actorId: string | null) => ({ speaker: { actor: actorId } })
const asSourceData = (actorId: string | null) => [undefined, { speaker: { actor: actorId } }]

beforeEach(() => resetChatOriginForTest())

describe('pendingMessageOf', () => {
  it('reads the speaker off the document, then the raw source data', () => {
    expect(pendingMessageOf(asDocument('act-1'), undefined).speaker?.actor).toBe('act-1')
    expect(pendingMessageOf(undefined, { speaker: { actor: 'act-2' } }).speaker?.actor).toBe(
      'act-2'
    )
  })

  it('survives a hook call with neither', () => {
    expect(pendingMessageOf(undefined, undefined).speaker).toBeUndefined()
    expect(pendingMessageOf(null, null).speaker).toBeUndefined()
    expect(pendingMessageOf({}, {}).speaker).toBeUndefined()
  })
})

describe('belongsToRequest', () => {
  it("matches a message spoken by the request's own actor", () => {
    expect(belongsToRequest(origin(), { speaker: { actor: 'act-1' } })).toBe(true)
  })

  // The bug this predicate exists for: PF2e and GM-side automation modules post
  // their own messages during exactly the window a handler is running, and the
  // first one through the door used to claim the request's capture.
  it("rejects a message spoken by someone else's actor", () => {
    expect(belongsToRequest(origin(), { speaker: { actor: 'act-other' } })).toBe(false)
  })

  it('rejects a message with no speaker actor', () => {
    expect(belongsToRequest(origin(), { speaker: { actor: null } })).toBe(false)
    expect(belongsToRequest(origin(), { speaker: {} })).toBe(false)
    expect(belongsToRequest(origin(), {})).toBe(false)
  })

  it('rejects everything when the request names no actor', () => {
    expect(belongsToRequest(origin({ actorId: undefined }), { speaker: { actor: 'act-1' } })).toBe(
      false
    )
  })
})

describe('chatOriginStampFor', () => {
  it('stamps nothing when no request is in flight', async () => {
    expect(chatOriginStampFor(asDocument('act-1'), undefined)).toBeUndefined()
  })

  it("carries the capture key on the request's own message", async () => {
    await withChatOrigin(origin(), async () => {
      expect(chatOriginStampFor(asDocument('act-1'), undefined)).toEqual({
        originUserId: 'usr-1',
        originUuid: 'req-1'
      })
    })
  })

  // The core of the fix: attribution still applies to a neighbouring message
  // (that is what the userId stamp is for), but the capture key does not — so
  // resolveCapture can't settle this request on somebody else's card.
  it('attributes but does NOT key a message from another actor', async () => {
    await withChatOrigin(origin(), async () => {
      const stamp = chatOriginStampFor(asDocument('act-someone-else'), undefined)
      expect(stamp).toEqual({ originUserId: 'usr-1' })
      expect(stamp?.originUuid).toBeUndefined()
    })
  })

  it('reads the speaker off raw source data too', async () => {
    await withChatOrigin(origin(), async () => {
      const [message, data] = asSourceData('act-1')
      expect(chatOriginStampFor(message, data)?.originUuid).toBe('req-1')
    })
  })

  // The tag exists so a GM can see which rolls had player-chosen faces, so it is
  // deliberately scoped broadly — losing it is worse than an extra one.
  it('tags a manual roll regardless of which message it lands on', async () => {
    await withChatOrigin(origin({ manualRoll: true }), async () => {
      expect(chatOriginStampFor(asDocument('act-1'), undefined)).toEqual({
        originUserId: 'usr-1',
        originUuid: 'req-1',
        manualRoll: true
      })
      expect(chatOriginStampFor(asDocument('act-other'), undefined)).toEqual({
        originUserId: 'usr-1',
        manualRoll: true
      })
    })
  })

  it('omits the manual tag for an ordinary roll', async () => {
    await withChatOrigin(origin(), async () => {
      expect(chatOriginStampFor(asDocument('act-1'), undefined)).not.toHaveProperty('manualRoll')
    })
  })
})

describe('withChatOrigin', () => {
  it('exposes the request while it runs and clears it afterwards', async () => {
    const frame = origin()
    await withChatOrigin(frame, async () => {
      expect(currentChatOrigin()).toBe(frame)
    })
    expect(currentChatOrigin()).toBeUndefined()
  })

  it('clears the request even when its handler throws', async () => {
    await expect(
      withChatOrigin(origin(), async () => {
        throw new Error('handler blew up')
      })
    ).rejects.toThrow('handler blew up')
    expect(currentChatOrigin()).toBeUndefined()
  })

  // Frames normally settle LIFO. They don't when the queue abandons a hung
  // handler: the next request starts while the hung one is still running, and a
  // positional pop would then discard the frame of the request executing NOW,
  // leaving the hung one's identity on top of the stack.
  it('removes the right frame when handlers settle out of order', async () => {
    const hung = origin({ userId: 'usr-hung', uuid: 'req-hung', actorId: 'act-hung' })
    const next = origin({ userId: 'usr-next', uuid: 'req-next', actorId: 'act-next' })

    let releaseHung: () => void = () => {}
    const hungDone = withChatOrigin(hung, () => new Promise<void>((r) => (releaseHung = r)))

    let releaseNext: () => void = () => {}
    const nextDone = withChatOrigin(next, () => new Promise<void>((r) => (releaseNext = r)))
    expect(currentChatOrigin()).toBe(next)

    // The hung handler settles FIRST, while `next` is still running.
    releaseHung()
    await hungDone
    expect(currentChatOrigin()).toBe(next)
    expect(chatOriginStampFor(asDocument('act-next'), undefined)?.originUuid).toBe('req-next')

    releaseNext()
    await nextDone
    expect(currentChatOrigin()).toBeUndefined()
  })
})

describe('abandonChatOrigin', () => {
  it('stops the abandoned request influencing anything, immediately', async () => {
    const hung = origin({ userId: 'usr-hung', uuid: 'req-hung', actorId: 'act-hung' })
    let release: () => void = () => {}
    const done = withChatOrigin(hung, () => new Promise<void>((r) => (release = r)))

    expect(currentChatOrigin()).toBe(hung)
    abandonChatOrigin(hung)

    expect(hung.abandoned).toBe(true)
    expect(currentChatOrigin()).toBeUndefined()
    // No attribution and no capture key: a message created now belongs to
    // whatever is running instead, not to a request the table gave up on.
    expect(chatOriginStampFor(asDocument('act-hung'), undefined)).toBeUndefined()

    release()
    await done
  })

  it('leaves a concurrently-running request untouched', async () => {
    const hung = origin({ userId: 'usr-hung', uuid: 'req-hung', actorId: 'act-hung' })
    const next = origin({ userId: 'usr-next', uuid: 'req-next', actorId: 'act-next' })
    let releaseHung: () => void = () => {}
    let releaseNext: () => void = () => {}
    const hungDone = withChatOrigin(hung, () => new Promise<void>((r) => (releaseHung = r)))
    abandonChatOrigin(hung)
    const nextDone = withChatOrigin(next, () => new Promise<void>((r) => (releaseNext = r)))

    expect(currentChatOrigin()).toBe(next)
    expect(chatOriginStampFor(asDocument('act-next'), undefined)).toEqual({
      originUserId: 'usr-next',
      originUuid: 'req-next'
    })

    releaseHung()
    await hungDone
    // The abandoned frame's late `finally` must not disturb the live request.
    expect(currentChatOrigin()).toBe(next)

    releaseNext()
    await nextDone
  })
})

describe('the attribution grace window', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  // PF2e emits follow-up messages just after the call that produced the roll
  // returns, so a settled request keeps attributing (but not keying) briefly.
  it('keeps attributing for a short while after a request settles', async () => {
    const start = Date.now()
    await withChatOrigin(origin(), async () => {})

    expect(currentChatOriginUserId(start + 1)).toBe('usr-1')
    expect(currentChatOriginUserId(start + CHAT_ORIGIN_GRACE_MS + 1)).toBeUndefined()
  })

  it('never carries a capture key into the grace window', async () => {
    const start = Date.now()
    await withChatOrigin(origin(), async () => {})

    // No live frame, so nothing to scope a uuid against: attribution only.
    expect(chatOriginStampFor(asDocument('act-1'), undefined, start + 1)).toEqual({
      originUserId: 'usr-1'
    })
  })

  // An abandoned request's handler can settle minutes after the queue moved on.
  // Opening a grace window then would attribute whatever is happening now to a
  // requester who timed out long ago.
  it('is NOT opened by an abandoned request settling', async () => {
    const hung = origin({ userId: 'usr-hung' })
    let release: () => void = () => {}
    const done = withChatOrigin(hung, () => new Promise<void>((r) => (release = r)))
    abandonChatOrigin(hung)

    const settledAt = Date.now()
    release()
    await done

    expect(currentChatOriginUserId(settledAt + 1)).toBeUndefined()
    expect(chatOriginStampFor(asDocument('act-1'), undefined, settledAt + 1)).toBeUndefined()
  })
})
