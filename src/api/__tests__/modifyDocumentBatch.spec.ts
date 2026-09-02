// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Socket } from 'socket.io-client'
import type DocumentSocketResponse from '@7h3laughingman/foundry-types/common/abstract/socket.mjs'

// One operation can produce SEVERAL responses. When it does, the server stops
// emitting the singular `modifyDocument` and broadcasts them together as
// `modifyDocumentBatch` — so a client subscribed only to the singular event
// silently misses every change that operation made.
//
// That is not a hypothetical: advancing an encounter past the end of a round
// carries a non-zero worldTime delta, so the server also writes the world clock
// and pushes it as a side effect. Round boundaries came through as a batch and
// were dropped; turn changes inside a round (delta 0) did not. These pin both
// delivery shapes reaching the same subscribers.

const handlers = new Map<string, (...args: unknown[]) => void>()
const emit = vi.fn()

const socket = {
  on: (event: string, handler: (...args: unknown[]) => void) => {
    handlers.set(event, handler)
  },
  off: (event: string) => {
    handlers.delete(event)
  },
  emit
} as unknown as Socket

vi.mock('@/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/internal')>()
  return { ...actual, getSocket: vi.fn(async () => socket) }
})

const { setupSocketListenersForApp, onModifyDocument } = await import('@/api/socketSetup')

// `sideEffect` is a batch-only marker the upstream response type predates, so
// the overrides are typed to allow it (see ModifyDocumentBatch).
function response(over: Partial<DocumentSocketResponse> & { sideEffect?: boolean } = {}) {
  return {
    type: 'Combat',
    action: 'update',
    result: [{ _id: 'c1', round: 4, turn: 0 }],
    operation: {},
    ...over
  } as unknown as DocumentSocketResponse
}

let seen: DocumentSocketResponse[]
let unsub: () => void

beforeEach(async () => {
  handlers.clear()
  emit.mockClear()
  seen = []
  await setupSocketListenersForApp()
  unsub?.()
  unsub = onModifyDocument((args) => seen.push(args))
})

describe('modifyDocument delivery', () => {
  it('subscribes to both the single and the batch event', () => {
    expect(handlers.has('modifyDocument')).toBe(true)
    expect(handlers.has('modifyDocumentBatch')).toBe(true)
  })

  it('delivers a single response', () => {
    handlers.get('modifyDocument')!(response())
    expect(seen).toHaveLength(1)
    expect(seen[0].type).toBe('Combat')
  })

  // The round-boundary shape: the world-clock Setting side effect first, the
  // encounter's own update last.
  it('fans a batch out to the same subscribers', () => {
    handlers.get('modifyDocumentBatch')!({
      results: [
        response({ type: 'Setting', result: [{ _id: 's1', value: '18' }], sideEffect: true }),
        response()
      ]
    })
    expect(seen.map((r) => r.type)).toEqual(['Setting', 'Combat'])
    expect(seen[1].result).toEqual([{ _id: 'c1', round: 4, turn: 0 }])
  })

  it('drops a malformed batch instead of throwing into the socket', () => {
    expect(() => handlers.get('modifyDocumentBatch')!({})).not.toThrow()
    expect(() => handlers.get('modifyDocumentBatch')!({ results: [] })).not.toThrow()
    expect(seen).toHaveLength(0)
  })

  // A subscriber that throws must not stop the rest of a batch from landing.
  it('keeps delivering a batch past a throwing subscriber', () => {
    const later: string[] = []
    const bad = onModifyDocument(() => {
      throw new Error('subscriber exploded')
    })
    const good = onModifyDocument((args) => later.push(args.type as string))
    handlers.get('modifyDocumentBatch')!({
      results: [response({ type: 'Setting', sideEffect: true }), response()]
    })
    expect(later).toEqual(['Setting', 'Combat'])
    bad()
    good()
  })
})
