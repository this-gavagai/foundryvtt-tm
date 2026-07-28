import { describe, it, expect, beforeEach, vi } from 'vitest'
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
// up on globalThis so the handler's finalize step can call through them.
const createMock = vi.fn<(data: Record<string, unknown>) => Promise<object>>(async () => ({}))
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

beforeEach(() => {
  vi.clearAllMocks()
  uploadFolder = 'audio/voice-memos'
  uploadMock.mockResolvedValue({ path: 'tablemate/voice-memos/test-world/x.m4a' })
  // makeAck (kept real) reads game.user; voiceMemoUploadPath reads
  // game.settings — both come off the real global, which the handler's mocked
  // getGame does not cover.
  ;(globalThis as Record<string, unknown>).game = {
    user: { _id: 'gm-1' },
    settings: { get: () => uploadFolder }
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
})
