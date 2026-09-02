// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Socket } from 'socket.io-client'

// The app's own writes are acknowledged, not broadcast back (see applyChatCreate
// in stores/world). That ack has TWO shapes: a single response normally, and a
// batch when the operation produced server-side side effects. Reading only the
// single shape reported a write the server had applied as FAILED — the caller
// threw and recoverFailedWrite re-fetched the actor. Same root cause as the
// dropped batch broadcasts (see modifyDocumentBatch.spec).

const emit = vi.fn()
const socket = { emit, on: () => {}, off: () => {} } as unknown as Socket

vi.mock('@/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/internal')>()
  return { ...actual, getSocket: vi.fn(async () => socket) }
})

const { modifyDocument } = await import('@/api/documents')

// Answer the next emit with `ack`.
function answerWith(ack: unknown) {
  emit.mockImplementation(
    (_event: string, _payload: unknown, cb: (r: unknown) => void) => void cb(ack)
  )
}

const payload = {
  type: 'Actor',
  action: 'update',
  operation: { updates: [{ _id: 'a1', name: 'Seelah' }] }
} as unknown as Parameters<typeof modifyDocument>[0]

const own = { type: 'Actor', action: 'update', result: [{ _id: 'a1', name: 'Seelah' }] }
const sideEffect = {
  type: 'Setting',
  action: 'update',
  result: [{ _id: 's1', value: '18' }],
  sideEffect: true
}

beforeEach(() => {
  emit.mockReset()
})

describe('modifyDocument ack', () => {
  it('resolves a single-response ack', async () => {
    answerWith(own)
    await expect(modifyDocument(payload)).resolves.toMatchObject({ result: own.result })
  })

  // The server orders side effects first and the operation's own response last.
  it('unwraps a batch ack to the operation own response', async () => {
    answerWith({ results: [sideEffect, own] })
    await expect(modifyDocument(payload)).resolves.toMatchObject({
      type: 'Actor',
      result: own.result
    })
  })

  it('picks the non-side-effect response whatever the order', async () => {
    answerWith({ results: [own, sideEffect] })
    await expect(modifyDocument(payload)).resolves.toMatchObject({ type: 'Actor' })
  })

  it('hands onResponse the unwrapped response', async () => {
    answerWith({ results: [sideEffect, own] })
    const seen: unknown[] = []
    await modifyDocument(payload, (r) => seen.push(r))
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ type: 'Actor' })
  })

  // A real failure must still read as one.
  it('still rejects an ack carrying an error', async () => {
    answerWith({ error: { message: 'nope' } })
    await expect(modifyDocument(payload)).rejects.toThrow(/failed/)
  })

  it('rejects a batch with no usable response', async () => {
    answerWith({ results: [{ type: 'Setting', sideEffect: true, error: 'boom' }] })
    await expect(modifyDocument(payload)).rejects.toThrow(/failed/)
  })
})
