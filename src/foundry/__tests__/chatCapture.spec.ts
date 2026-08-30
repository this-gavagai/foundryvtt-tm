import { describe, it, expect } from 'vitest'
import { registerCapture, resolveCapture, settleCapture } from '@/foundry/chatCapture'

// settleCapture exists for the roll handlers, which register a capture before
// rolling and then need an answer the moment the roll returns: the card they are
// after — if the pipeline posted one at all — already exists by then, so waiting
// out the capture's own five-second timeout would delay every ack from a roll
// that posted nothing.

describe('settleCapture', () => {
  it('answers a pending capture with nothing', async () => {
    const capture = registerCapture('req-1')
    settleCapture('req-1')
    await expect(capture).resolves.toBeUndefined()
  })

  it('leaves a capture that already resolved alone', async () => {
    const capture = registerCapture('req-2')
    resolveCapture('req-2', { id: 'msg-1' })
    // The happy path: the message landed during the roll, so this is a no-op and
    // the awaited promise still yields it.
    settleCapture('req-2')
    await expect(capture).resolves.toEqual({ id: 'msg-1' })
  })

  it('is harmless for a uuid nobody is waiting on', () => {
    expect(() => settleCapture('never-registered')).not.toThrow()
  })

  it('does not settle a different request', async () => {
    const capture = registerCapture('req-3')
    settleCapture('req-4')
    resolveCapture('req-3', { id: 'msg-2' })
    await expect(capture).resolves.toEqual({ id: 'msg-2' })
  })
})
