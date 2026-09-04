import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The ack queue is the correlation layer under every RPC: uuid → pending
// resolver, drained by a matching ack, an error ack, the 30s timeout, or a
// socket swap (rejectAllPending). These tests pin that lifecycle through the
// public surface — sendItemToChat() as a representative sendAction caller,
// resolveAck() standing in for the wire.

const { emit } = vi.hoisted(() => ({ emit: vi.fn() }))

vi.mock('@/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/internal')>()
  return {
    ...actual,
    getAuthenticatedSocket: vi.fn(async () => ({ socket: { emit }, userId: 'user-1' }))
  }
})

import { sendItemToChat, resolveAck, rejectAllPending, TM_ERROR_NO_LISTENER } from '@/api/actionRpc'
import { TM, TM_ERROR_TARGET_UNRESOLVED } from '@/api/protocol'
import { registerStoreBridge, resetStoreBridgeForTest } from '@/api/storeBridge'
import type { RequestResolutionArgs } from '@/types/api-types'
import { fakeStoreBridge, flushMicrotasks, lastEmittedUuid as lastUuid } from './socketMock'

const lastEmittedUuid = () => lastUuid(emit)

function ackFor(uuid: string, extra: Partial<RequestResolutionArgs> = {}): RequestResolutionArgs {
  return { action: TM.ACK, uuid, userId: 'gm-1', ...extra }
}

beforeEach(() => {
  emit.mockClear()
  // sendAction asks the bridge whether anything is listening before it sends,
  // so every test needs one registered. The default says a GM is there — these
  // tests are about the ack lifecycle, not about the backstop below.
  registerStoreBridge(fakeStoreBridge())
})
afterEach(() => {
  // Never leave a pending entry behind for the next test.
  rejectAllPending('test teardown')
  vi.useRealTimers()
})

// A BACKSTOP for a missing UI gate, not the gate itself: which affordance to
// hide, disable or fall back to is decided per affordance (see
// stores/listenersOnline.ts). This is what happens when one of those is
// forgotten — the request fails at once and says why, instead of sitting out the
// full 30s ack budget and then reporting nothing.
describe('with no module client listening', () => {
  beforeEach(() => {
    registerStoreBridge(fakeStoreBridge({ isListening: () => false }))
  })

  it('refuses the request without emitting it', async () => {
    await expect(sendItemToChat('actor-1', 'item-1')).rejects.toThrow(TM_ERROR_NO_LISTENER)
    expect(emit).not.toHaveBeenCalled()
  })

  it('leaves nothing pending, so no later ack or timeout can settle it', async () => {
    await expect(sendItemToChat('actor-1', 'item-1')).rejects.toThrow(TM_ERROR_NO_LISTENER)
    // rejectAllPending drains the queue by resolving each entry; with nothing in
    // it there is nothing to drain, and the teardown below stays quiet.
    expect(() => rejectAllPending('nothing should be pending')).not.toThrow()
  })
})

describe('sendAction ack correlation', () => {
  it('resolves the pending request when its ack arrives', async () => {
    const pending = sendItemToChat('actor-1', 'item-1')
    await flushMicrotasks()
    const uuid = lastEmittedUuid()

    resolveAck(uuid, ackFor(uuid, { compendia: [] }))
    await expect(pending).resolves.toMatchObject({ uuid, compendia: [] })
  })

  it('rejects when the ack carries an error (thrown Foundry handler)', async () => {
    const pending = sendItemToChat('actor-1', 'item-1')
    await flushMicrotasks()
    const uuid = lastEmittedUuid()

    resolveAck(uuid, ackFor(uuid, { error: 'handler exploded' }))
    await expect(pending).rejects.toThrow('handler exploded')
  })

  it('ignores an ack with no matching pending request', async () => {
    const pending = sendItemToChat('actor-1', 'item-1')
    await flushMicrotasks()
    const uuid = lastEmittedUuid()

    resolveAck('some-other-uuid', ackFor('some-other-uuid'))
    resolveAck(uuid, ackFor(uuid))
    await expect(pending).resolves.toMatchObject({ uuid })
    // A duplicate ack after settling must be a no-op, not a crash.
    resolveAck(uuid, ackFor(uuid))
  })

  it('rejects after the ack timeout instead of hanging forever', async () => {
    vi.useFakeTimers()
    const pending = sendItemToChat('actor-1', 'item-1')
    await flushMicrotasks()
    lastEmittedUuid()

    const expectation = expect(pending).rejects.toThrow(/timed out after 30000ms/)
    vi.advanceTimersByTime(30_000)
    await expectation
  })

  it('does not time out a request that was already answered', async () => {
    vi.useFakeTimers()
    const pending = sendItemToChat('actor-1', 'item-1')
    await flushMicrotasks()
    const uuid = lastEmittedUuid()

    resolveAck(uuid, ackFor(uuid, { compendia: [] }))
    vi.advanceTimersByTime(60_000)
    await expect(pending).resolves.toMatchObject({ uuid })
  })
})

// `uuid` is read straight off a shared socket channel, so it is untrusted input
// into whatever the queue is keyed by. Backed by a Map for that reason: an object
// literal answers 'constructor' and 'toString' with inherited functions, and the
// drain path would have called one as a resolver. Same hazard, same reasoning as
// the hasOwnProperty guard in foundry/rpcTable.ts.
describe('an ack naming an inherited property', () => {
  for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    it(`ignores an ack for '${key}' instead of calling it`, () => {
      expect(() => resolveAck(key, ackFor(key))).not.toThrow()
    })
  }

  it('still settles a real request afterwards', async () => {
    resolveAck('constructor', ackFor('constructor'))
    const pending = sendItemToChat('actor-1', 'item-1')
    await flushMicrotasks()
    const uuid = lastEmittedUuid()
    resolveAck(uuid, ackFor(uuid))
    await expect(pending).resolves.toMatchObject({ uuid })
  })
})

describe('stale-target refusal', () => {
  // The module refuses a request whose targets it cannot find rather than
  // rolling untargeted. The app treats that as "my mirror of the proxy's
  // targeting is out of date" and resyncs at this one boundary, so every
  // targeted RPC — damage previews as much as rolls — recovers.
  it('resyncs the mirrored targets when the module reports them unresolvable', async () => {
    const resyncTargets = vi.fn()
    registerStoreBridge(fakeStoreBridge({ resyncTargets }))
    const pending = sendItemToChat('actor-1', 'item-1')
    await flushMicrotasks()
    const uuid = lastEmittedUuid()

    resolveAck(uuid, ackFor(uuid, { error: TM_ERROR_TARGET_UNRESOLVED }))
    await expect(pending).rejects.toThrow(TM_ERROR_TARGET_UNRESOLVED)
    expect(resyncTargets).toHaveBeenCalledTimes(1)
    resetStoreBridgeForTest()
  })

  it('leaves the mirror alone for any other failure', async () => {
    const resyncTargets = vi.fn()
    registerStoreBridge(fakeStoreBridge({ resyncTargets }))
    const pending = sendItemToChat('actor-1', 'item-1')
    await flushMicrotasks()
    const uuid = lastEmittedUuid()

    resolveAck(uuid, ackFor(uuid, { error: 'handler exploded' }))
    await expect(pending).rejects.toThrow('handler exploded')
    expect(resyncTargets).not.toHaveBeenCalled()
    resetStoreBridgeForTest()
  })

  it('still rejects the caller when no bridge is registered to resync', async () => {
    // The resync is best-effort; a throw escaping the ack callback would strand
    // the caller until the 30s timeout. Dropped AFTER the send, since sendAction
    // now reads the bridge on the way out too.
    const pending = sendItemToChat('actor-1', 'item-1')
    await flushMicrotasks()
    const uuid = lastEmittedUuid()
    resetStoreBridgeForTest()

    resolveAck(uuid, ackFor(uuid, { error: TM_ERROR_TARGET_UNRESOLVED }))
    await expect(pending).rejects.toThrow(TM_ERROR_TARGET_UNRESOLVED)
  })
})

describe('rejectAllPending (socket swap)', () => {
  it('rejects every in-flight request with the given reason and drains the queue', async () => {
    const first = sendItemToChat('actor-1', 'item-1')
    const second = sendItemToChat('actor-1', 'item-1')
    await flushMicrotasks()
    expect(emit).toHaveBeenCalledTimes(2)
    const uuid = lastEmittedUuid()

    rejectAllPending('connection replaced')
    await expect(first).rejects.toThrow('connection replaced')
    await expect(second).rejects.toThrow('connection replaced')

    // Queue drained: a late ack for the dead socket's request is a no-op.
    resolveAck(uuid, ackFor(uuid))
  })
})
