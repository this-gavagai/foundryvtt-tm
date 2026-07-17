import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The ack queue is the correlation layer under every RPC: uuid → pending
// resolver, drained by a matching ack, an error ack, the 30s timeout, or a
// socket swap (rejectAllPending). These tests pin that lifecycle through the
// public surface — listCompendia() as a representative sendAction caller,
// resolveAck() standing in for the wire.

const { emit } = vi.hoisted(() => ({ emit: vi.fn() }))

vi.mock('@/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/internal')>()
  return {
    ...actual,
    getAuthenticatedSocket: vi.fn(async () => ({ socket: { emit }, userId: 'user-1' }))
  }
})

import { listCompendia, resolveAck, rejectAllPending } from '@/api/actionRpc'
import { TM } from '@/api/protocol'
import type { RequestResolutionArgs } from '@/types/api-types'
import { flushMicrotasks, lastEmittedUuid as lastUuid } from './socketMock'

const lastEmittedUuid = () => lastUuid(emit)

function ackFor(uuid: string, extra: Partial<RequestResolutionArgs> = {}): RequestResolutionArgs {
  return { action: TM.ACK, uuid, userId: 'gm-1', ...extra }
}

beforeEach(() => {
  emit.mockClear()
})
afterEach(() => {
  // Never leave a pending entry behind for the next test.
  rejectAllPending('test teardown')
  vi.useRealTimers()
})

describe('sendAction ack correlation', () => {
  it('resolves the pending request when its ack arrives', async () => {
    const pending = listCompendia()
    await flushMicrotasks()
    const uuid = lastEmittedUuid()

    resolveAck(uuid, ackFor(uuid, { compendia: [] }))
    await expect(pending).resolves.toMatchObject({ uuid, compendia: [] })
  })

  it('rejects when the ack carries an error (thrown Foundry handler)', async () => {
    const pending = listCompendia()
    await flushMicrotasks()
    const uuid = lastEmittedUuid()

    resolveAck(uuid, ackFor(uuid, { error: 'handler exploded' }))
    await expect(pending).rejects.toThrow('handler exploded')
  })

  it('ignores an ack with no matching pending request', async () => {
    const pending = listCompendia()
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
    const pending = listCompendia()
    await flushMicrotasks()
    lastEmittedUuid()

    const expectation = expect(pending).rejects.toThrow(/timed out after 30000ms/)
    vi.advanceTimersByTime(30_000)
    await expectation
  })

  it('does not time out a request that was already answered', async () => {
    vi.useFakeTimers()
    const pending = listCompendia()
    await flushMicrotasks()
    const uuid = lastEmittedUuid()

    resolveAck(uuid, ackFor(uuid, { compendia: [] }))
    vi.advanceTimersByTime(60_000)
    await expect(pending).resolves.toMatchObject({ uuid })
  })
})

describe('rejectAllPending (socket swap)', () => {
  it('rejects every in-flight request with the given reason and drains the queue', async () => {
    const first = listCompendia()
    const second = listCompendia()
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
