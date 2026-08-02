// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, computed } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { ChatMessageData } from '@/composables/useChatMessages'
import { VOICE_MEMO_CHUNK_SIZE } from '@/utils/voiceMemoChunks'

// A recording crosses to the GM as a series of chunk RPCs, each awaiting its ack
// before the next goes out. These cover what that costs a memo of real length:
// how many round trips it takes, that one lost ack doesn't throw the recording
// away, and that a genuine failure is reported as an upload rather than as a
// message that wouldn't post.

type UploadChunkArgs = { uploadId: string; seq: number; total: number; chunkBase64: string }

const sendVoiceMemo = vi.fn<
  (characterId: string, chunk: UploadChunkArgs, meta: unknown) => Promise<{ messageId?: string }>
>(async () => ({ messageId: 'msg-1' }))

vi.mock('@/api/actionRpc', () => ({
  applyDamage: vi.fn(),
  consumeItem: vi.fn(),
  rerollChatRoll: vi.fn(),
  sendImage: vi.fn(),
  sendVoiceMemo: (...args: Parameters<typeof sendVoiceMemo>) => sendVoiceMemo(...args),
  toggleReaction: vi.fn()
}))
vi.mock('@/api/documents', () => ({ modifyDocument: vi.fn(async () => ({ result: [] })) }))
// Native-only side effect the composable pulls in transitively.
vi.mock('@/composables/useHapticFeedback', () => ({ triggerLightHapticFeedback: vi.fn() }))

const { useChatActions } = await import('@/composables/useChatActions')

function makeActions() {
  return useChatActions({
    actorId: ref('seelah-id'),
    actor: ref(undefined),
    messages: computed<ChatMessageData[]>(() => []),
    messageIsOwnActor: () => true
  })
}

const memo = { mimeType: 'audio/mp4', durationMs: 62_000 }

// A minute of audio at the ~180 kbps these memos record at.
function minuteLongRecording(): { blob: Blob; bytes: Uint8Array } {
  const bytes = new Uint8Array(Math.round((183_000 / 8) * 60))
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256
  return { blob: new Blob([bytes]), bytes }
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.stubGlobal('__APP_VERSION__', '0.0.0-test')
  setActivePinia(createPinia())
  sendVoiceMemo.mockResolvedValue({ messageId: 'msg-1' })
})

describe('submitVoiceMemo chunk streaming', () => {
  it('streams a minute-long memo in a handful of chunks, whole and in order', async () => {
    const { blob, bytes } = minuteLongRecording()
    const actions = makeActions()
    await actions.submitVoiceMemo(blob, memo)

    const expected = Math.ceil(bytes.length / VOICE_MEMO_CHUNK_SIZE)
    expect(sendVoiceMemo).toHaveBeenCalledTimes(expected)
    // Sized so a minute is a few round trips rather than the seven it once took.
    expect(expected).toBeLessThanOrEqual(3)

    // Every chunk shares one uploadId and declares the same total, and the bytes
    // reassemble to exactly what was recorded.
    const chunks = sendVoiceMemo.mock.calls.map((call) => call[1])
    expect(new Set(chunks.map((c) => c.uploadId)).size).toBe(1)
    expect(chunks.map((c) => c.seq)).toEqual(chunks.map((_, i) => i))
    expect(chunks.every((c) => c.total === expected)).toBe(true)

    const rebuilt = chunks.flatMap((c) => Array.from(atob(c.chunkBase64), (ch) => ch.charCodeAt(0)))
    expect(rebuilt).toEqual(Array.from(bytes))
    expect(actions.sendError.value).toBeNull()
  })

  it('retries a chunk whose ack never came instead of losing the recording', async () => {
    const { blob, bytes } = minuteLongRecording()
    const total = Math.ceil(bytes.length / VOICE_MEMO_CHUNK_SIZE)
    // The second chunk's ack goes missing once — a socket gap, or an ack that
    // lands after the 30s budget.
    let calls = 0
    sendVoiceMemo.mockImplementation(async () => {
      calls += 1
      if (calls === 2) throw new Error('request timed out after 30000ms')
      return { messageId: 'msg-1' }
    })

    const actions = makeActions()
    await actions.submitVoiceMemo(blob, memo)

    expect(actions.sendError.value).toBeNull()
    expect(sendVoiceMemo).toHaveBeenCalledTimes(total + 1)
    // The retry re-sends the SAME chunk, so the GM can fill the slot it missed.
    const [first, retried] = [sendVoiceMemo.mock.calls[1][1], sendVoiceMemo.mock.calls[2][1]]
    expect(retried.seq).toBe(first.seq)
    expect(retried.uploadId).toBe(first.uploadId)
    expect(retried.chunkBase64).toBe(first.chunkBase64)
  })

  it('reports an upload failure when the retry fails too', async () => {
    sendVoiceMemo.mockRejectedValue(new Error('Voice memo upload returned no path'))
    const actions = makeActions()
    await actions.submitVoiceMemo(minuteLongRecording().blob, memo)

    // Distinct from a message that wouldn't post: the take is still in the
    // composer, so the composer says the upload didn't finish.
    expect(actions.sendError.value).toBe('upload')
    expect(sendVoiceMemo).toHaveBeenCalledTimes(2) // the chunk, then its one retry
  })
})
