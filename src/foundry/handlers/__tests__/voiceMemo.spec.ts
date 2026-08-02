import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { TM } from '@/api/protocol'
import type { SendVoiceMemoArgs } from '@/types/api-types'

// getGame is the only Foundry-global accessor the voice-memo handler uses that
// can't run in node; mock it and leave the rest of the util module (makeAck
// etc.) real so the ack shape is exercised for free.
const fakeActor = { name: 'Seelah' }
// users is iterable so resolveWhisperRecipients (Array.from over it) can map
// 'gm'/'[Name]' command targets to ids, matching the text-message path.
const fakeGame = {
  actors: { get: vi.fn(() => fakeActor) },
  world: { id: 'test-world' },
  users: [
    { id: 'gm-1', name: 'GM', isGM: true },
    { id: 'user-2', name: 'Bob', isGM: false }
  ]
}
vi.mock('@/foundry/utils/foundry', async (importActual) => {
  const actual = await importActual<typeof import('@/foundry/utils/foundry')>()
  return { ...actual, getGame: vi.fn(() => fakeGame) }
})

// ChatMessage and FilePicker are bare Foundry globals in the client; stand them
// up on globalThis so the handler's finalize step can call through them. create
// returns a document with an id, which the handler reports in the final chunk's
// ack so the sending app can patch its transcript onto the memo.
const createMock = vi.fn<(data: Record<string, unknown>) => Promise<object>>(async () => ({
  id: 'msg-1'
}))
const uploadMock = vi.fn<
  (source: string, path: string, file: File, body?: object, options?: object) => Promise<{ path: string }>
>(async () => ({ path: 'tablemate/voice-memos/test-world/x.m4a' }))
const createDirectoryMock = vi.fn<(source: string, target: string, options?: object) => Promise<object>>(
  async () => ({})
)
// browse resolves → ensureDirectory treats the folder as existing and skips
// createDirectory (the real first-upload path creates; either is fine here).
const browseMock = vi.fn<(source: string, target: string, options?: object) => Promise<object>>(
  async () => ({ dirs: [], files: [] })
)

// The configured upload folder the voice-memo setting reports; individual tests
// override it (e.g. '' to simulate a world that hasn't enabled the feature).
let uploadFolder = 'audio/voice-memos'

// Nothing on this side transcribes any more (the recording app does — see
// api/transcription.ts), so a call to fetch from the handler is itself a bug.
const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.clearAllMocks()
  uploadFolder = 'audio/voice-memos'
  uploadMock.mockResolvedValue({ path: 'tablemate/voice-memos/test-world/x.m4a' })
  ;(globalThis as Record<string, unknown>).fetch = fetchMock
  // makeAck (kept real) reads game.user; voiceMemoUploadPath reads game.settings
  // by key — resolve it from the per-test state so an unrelated key never
  // masquerades as a configured folder.
  ;(globalThis as Record<string, unknown>).game = {
    user: { _id: 'gm-1' },
    settings: {
      get: (_scope: string, key: string) => (key === 'voiceMemoPath' ? uploadFolder : '')
    }
  }
  ;(globalThis as Record<string, unknown>).ChatMessage = {
    create: createMock,
    getSpeaker: vi.fn(() => ({ actor: 'seelah-id' }))
  }
  ;(globalThis as Record<string, unknown>).FilePicker = {
    upload: uploadMock,
    createDirectory: createDirectoryMock,
    browse: browseMock
  }
})

const { foundrySendVoiceMemo } = await import('@/foundry/handlers/chat')

// Encode raw bytes to base64 the way the app would, per chunk.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function chunkArgs(overrides: Partial<SendVoiceMemoArgs>): SendVoiceMemoArgs {
  return {
    action: TM.SEND_VOICE_MEMO,
    userId: 'user-1',
    characterId: 'seelah-id',
    uploadId: 'upload-1',
    seq: 0,
    total: 1,
    chunkBase64: '',
    mimeType: 'audio/mp4',
    durationMs: 3000,
    uuid: 'req-uuid',
    ...overrides
  }
}

describe('foundrySendVoiceMemo', () => {
  it('acks intermediate chunks without creating a message', async () => {
    const ack = await foundrySendVoiceMemo(
      chunkArgs({ uploadId: 'multi', seq: 0, total: 2, chunkBase64: bytesToBase64(new Uint8Array([1, 2])) })
    )
    expect(ack.action).toBe(TM.ACK)
    expect(createMock).not.toHaveBeenCalled()
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('reassembles chunk bytes in order on the final chunk, then uploads + posts', async () => {
    const first = new Uint8Array([10, 20, 30])
    const second = new Uint8Array([40, 50])
    await foundrySendVoiceMemo(
      chunkArgs({ uploadId: 'ab', seq: 0, total: 2, chunkBase64: bytesToBase64(first) })
    )
    await foundrySendVoiceMemo(
      chunkArgs({ uploadId: 'ab', seq: 1, total: 2, chunkBase64: bytesToBase64(second) })
    )

    expect(uploadMock).toHaveBeenCalledTimes(1)
    // Uploads to the GM-configured folder.
    expect(uploadMock.mock.calls[0][1]).toBe('audio/voice-memos')
    const uploadedFile = uploadMock.mock.calls[0][2] as File
    const bytes = new Uint8Array(await uploadedFile.arrayBuffer())
    expect(Array.from(bytes)).toEqual([10, 20, 30, 40, 50])
    expect(uploadedFile.name).toBe('ab.m4a')

    expect(createMock).toHaveBeenCalledTimes(1)
    const created = createMock.mock.calls[0][0] as {
      content: string
      flags: { tablemate: { audioPath: string; audioDurationMs: number } }
    }
    expect(created.content).toContain('<audio')
    expect(created.content).toContain('tablemate/voice-memos/test-world/x.m4a')
    expect(created.flags.tablemate.audioPath).toBe('tablemate/voice-memos/test-world/x.m4a')
  })

  it('reassembles out-of-order chunks by their seq index', async () => {
    await foundrySendVoiceMemo(
      chunkArgs({ uploadId: 'ooo', seq: 1, total: 2, chunkBase64: bytesToBase64(new Uint8Array([9])) })
    )
    await foundrySendVoiceMemo(
      chunkArgs({ uploadId: 'ooo', seq: 0, total: 2, chunkBase64: bytesToBase64(new Uint8Array([7, 8])) })
    )
    const uploadedFile = uploadMock.mock.calls[0][2] as File
    expect(Array.from(new Uint8Array(await uploadedFile.arrayBuffer()))).toEqual([7, 8, 9])
  })

  it('is idempotent on a re-sent chunk (does not double-count toward completion)', async () => {
    const args = chunkArgs({
      uploadId: 'dup',
      seq: 0,
      total: 2,
      chunkBase64: bytesToBase64(new Uint8Array([1]))
    })
    await foundrySendVoiceMemo(args)
    await foundrySendVoiceMemo(args) // retry of the same chunk
    expect(createMock).not.toHaveBeenCalled() // still waiting on seq 1
    await foundrySendVoiceMemo(
      chunkArgs({ uploadId: 'dup', seq: 1, total: 2, chunkBase64: bytesToBase64(new Uint8Array([2])) })
    )
    expect(createMock).toHaveBeenCalledTimes(1)
  })

  it('resolves whisper command targets to recipient ids like the text path', async () => {
    await foundrySendVoiceMemo(
      chunkArgs({
        uploadId: 'whisper',
        seq: 0,
        total: 1,
        chunkBase64: bytesToBase64(new Uint8Array([1, 2, 3])),
        whisper: ['gm', '[Bob]']
      })
    )
    const created = createMock.mock.calls[0][0] as { whisper?: string[] }
    expect(created.whisper).toEqual(['gm-1', 'user-2'])
  })

  it('scopes a private memo to its author when no whisper target resolves', async () => {
    await foundrySendVoiceMemo(
      chunkArgs({
        uploadId: 'whisper-empty',
        seq: 0,
        total: 1,
        chunkBase64: bytesToBase64(new Uint8Array([1])),
        whisper: ['[Nobody]']
      })
    )
    const created = createMock.mock.calls[0][0] as { whisper?: string[] }
    expect(created.whisper).toEqual(['user-1'])
  })

  it('rejects a chunk index outside the declared total', async () => {
    await expect(
      foundrySendVoiceMemo(chunkArgs({ uploadId: 'bad', seq: 3, total: 2, chunkBase64: 'AA==' }))
    ).rejects.toThrow(/out of range/)
  })

  it('rejects a non-positive total', async () => {
    await expect(
      foundrySendVoiceMemo(chunkArgs({ uploadId: 'bad2', seq: 0, total: 0, chunkBase64: 'AA==' }))
    ).rejects.toThrow(/invalid chunk count/)
  })

  it('rejects a chunk total above the sanity cap', async () => {
    await expect(
      foundrySendVoiceMemo(chunkArgs({ uploadId: 'bad3', seq: 0, total: 100000, chunkBase64: 'AA==' }))
    ).rejects.toThrow(/invalid chunk count/)
  })

  it('refuses to record when the world has no configured destination folder', async () => {
    uploadFolder = ''
    await expect(
      foundrySendVoiceMemo(
        chunkArgs({
          uploadId: 'disabled',
          seq: 0,
          total: 1,
          chunkBase64: bytesToBase64(new Uint8Array([1, 2, 3]))
        })
      )
    ).rejects.toThrow(/not enabled/)
    expect(uploadMock).not.toHaveBeenCalled()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('posts the memo with no transcript of its own — transcription is the app’s job now', async () => {
    await foundrySendVoiceMemo(
      chunkArgs({ uploadId: 'no-tx', seq: 0, total: 1, chunkBase64: bytesToBase64(new Uint8Array([1, 2])) })
    )
    const created = createMock.mock.calls[0][0] as {
      content: string
      flags: { tablemate: Record<string, unknown> }
    }
    expect(created.flags.tablemate).not.toHaveProperty('transcript')
    expect(created.content).not.toContain('data-tablemate-transcript')
    // Give any (mistaken) async work a tick to run before asserting the negative.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports the posted message on the final chunk so the sender can patch its transcript on', async () => {
    const first = await foundrySendVoiceMemo(
      chunkArgs({ uploadId: 'ack', seq: 0, total: 2, chunkBase64: bytesToBase64(new Uint8Array([1])) })
    )
    // Nothing is posted yet, so an intermediate chunk names no message.
    expect(first.messageId).toBeUndefined()
    expect(first.content).toBeUndefined()

    const last = await foundrySendVoiceMemo(
      chunkArgs({ uploadId: 'ack', seq: 1, total: 2, chunkBase64: bytesToBase64(new Uint8Array([2])) })
    )
    expect(last.messageId).toBe('msg-1')
    // The content the app appends its transcript to — same string that was posted.
    expect(last.content).toBe((createMock.mock.calls[0][0] as { content: string }).content)
  })

  it('records the sender’s "a transcript is coming" declaration as a flag', async () => {
    // Read only by the push notifier, which holds a memo's notification briefly
    // so it can carry the spoken words (foundry/pushNotify.ts).
    await foundrySendVoiceMemo(
      chunkArgs({
        uploadId: 'pending',
        seq: 0,
        total: 1,
        chunkBase64: bytesToBase64(new Uint8Array([1])),
        transcriptPending: true
      })
    )
    const created = createMock.mock.calls[0][0] as { flags: { tablemate: Record<string, unknown> } }
    expect(created.flags.tablemate.transcriptPending).toBe(true)
  })

  it('omits the pending flag when the sender is not transcribing', async () => {
    await foundrySendVoiceMemo(
      chunkArgs({ uploadId: 'not-pending', seq: 0, total: 1, chunkBase64: bytesToBase64(new Uint8Array([1])) })
    )
    const created = createMock.mock.calls[0][0] as { flags: { tablemate: Record<string, unknown> } }
    expect(created.flags.tablemate).not.toHaveProperty('transcriptPending')
  })

  // A minute of audio is several chunks and a five-minute memo is a dozen, each
  // its own RPC awaiting its own ack. These pin the two halves of surviving that:
  // a buffer that outlives a slow upload, and an outcome a retried chunk can be
  // answered with.
  describe('a long, multi-chunk upload', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('keeps its buffer for as long as chunks keep arriving', async () => {
      vi.useFakeTimers()
      // Three chunks, 50s apart: every gap is inside the budget, but the upload
      // takes 100s in total — which a per-upload deadline would have killed.
      for (const seq of [0, 1, 2]) {
        await foundrySendVoiceMemo(
          chunkArgs({
            uploadId: 'slow',
            seq,
            total: 3,
            chunkBase64: bytesToBase64(new Uint8Array([seq]))
          })
        )
        if (seq < 2) await vi.advanceTimersByTimeAsync(50_000)
      }
      expect(createMock).toHaveBeenCalledTimes(1)
      const uploadedFile = uploadMock.mock.calls[0][2] as File
      expect(Array.from(new Uint8Array(await uploadedFile.arrayBuffer()))).toEqual([0, 1, 2])
    })

    it('refuses the next chunk once the gap budget has run out', async () => {
      vi.useFakeTimers()
      await foundrySendVoiceMemo(
        chunkArgs({ uploadId: 'stalled', seq: 0, total: 2, chunkBase64: bytesToBase64(new Uint8Array([1])) })
      )
      await vi.advanceTimersByTimeAsync(61_000)
      // Answering this with a bare ack would tell the app the memo was on its
      // way when its first half is already gone.
      await expect(
        foundrySendVoiceMemo(
          chunkArgs({ uploadId: 'stalled', seq: 1, total: 2, chunkBase64: bytesToBase64(new Uint8Array([2])) })
        )
      ).rejects.toThrow(/stalled/)
      expect(createMock).not.toHaveBeenCalled()
    })

    it('replays the posted message when the sender retries the final chunk', async () => {
      // The app retries a chunk whose ack it never heard. For the LAST chunk that
      // ack carries the message id, so the retry has to be answered with the memo
      // that posted rather than opening a fresh, forever-incomplete upload.
      const chunks = [0, 1].map((seq) =>
        chunkArgs({
          uploadId: 'retry-last',
          seq,
          total: 2,
          chunkBase64: bytesToBase64(new Uint8Array([seq]))
        })
      )
      await foundrySendVoiceMemo(chunks[0])
      const first = await foundrySendVoiceMemo(chunks[1])
      const replay = await foundrySendVoiceMemo(chunks[1])

      expect(replay.messageId).toBe(first.messageId)
      expect(replay.content).toBe(first.content)
      // And the memo posted once, not twice.
      expect(createMock).toHaveBeenCalledTimes(1)
      expect(uploadMock).toHaveBeenCalledTimes(1)
    })

    it('replays the failure when the sender retries a final chunk that failed', async () => {
      uploadMock.mockResolvedValueOnce({ path: '' })
      const args = chunkArgs({
        uploadId: 'retry-failed',
        seq: 0,
        total: 1,
        chunkBase64: bytesToBase64(new Uint8Array([1]))
      })
      await expect(foundrySendVoiceMemo(args)).rejects.toThrow(/returned no path/)
      // The retry surfaces the same failure instead of acking as if it had worked.
      await expect(foundrySendVoiceMemo(args)).rejects.toThrow(/returned no path/)
      expect(uploadMock).toHaveBeenCalledTimes(1)
      expect(createMock).not.toHaveBeenCalled()
    })
  })
})
