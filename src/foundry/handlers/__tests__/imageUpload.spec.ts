import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TM } from '@/api/protocol'
import type { SendImageArgs } from '@/types/api-types'

// Mirrors voiceMemo.spec.ts: mock getGame (the only un-node-able Foundry
// accessor the handler uses) and stand ChatMessage/FilePicker up on globalThis.
const fakeActor = { name: 'Seelah' }
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

const createMock = vi.fn<(data: Record<string, unknown>) => Promise<object>>(async () => ({}))
const uploadMock = vi.fn<
  (source: string, path: string, file: File, body?: object, options?: object) => Promise<{ path: string }>
>(async () => ({ path: 'tablemate/images/test-world/x.jpg' }))
const createDirectoryMock = vi.fn(async () => ({}))
const browseMock = vi.fn(async () => ({ dirs: [], files: [] }))

// The configured image folder the setting reports; tests override it (e.g. '' to
// simulate a world that hasn't enabled the feature).
let uploadFolder = 'tablemate/images'

beforeEach(() => {
  vi.clearAllMocks()
  uploadFolder = 'tablemate/images'
  uploadMock.mockResolvedValue({ path: 'tablemate/images/test-world/x.jpg' })
  ;(globalThis as Record<string, unknown>).game = {
    user: { _id: 'gm-1' },
    settings: {
      get: (_scope: string, key: string) => (key === 'imageUploadPath' ? uploadFolder : '')
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

const { foundrySendImage } = await import('@/foundry/handlers/chat')

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function chunkArgs(overrides: Partial<SendImageArgs>): SendImageArgs {
  return {
    action: TM.SEND_IMAGE,
    userId: 'user-1',
    characterId: 'seelah-id',
    uploadId: 'img-1',
    seq: 0,
    total: 1,
    chunkBase64: '',
    mimeType: 'image/jpeg',
    width: 800,
    height: 600,
    uuid: 'req-uuid',
    ...overrides
  }
}

describe('foundrySendImage', () => {
  it('acks intermediate chunks without creating a message', async () => {
    const ack = await foundrySendImage(
      chunkArgs({ uploadId: 'multi', seq: 0, total: 2, chunkBase64: bytesToBase64(new Uint8Array([1, 2])) })
    )
    expect(ack.action).toBe(TM.ACK)
    expect(createMock).not.toHaveBeenCalled()
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('reassembles chunk bytes in order on the final chunk, then uploads + posts', async () => {
    await foundrySendImage(
      chunkArgs({ uploadId: 'ab', seq: 0, total: 2, chunkBase64: bytesToBase64(new Uint8Array([10, 20, 30])) })
    )
    await foundrySendImage(
      chunkArgs({ uploadId: 'ab', seq: 1, total: 2, chunkBase64: bytesToBase64(new Uint8Array([40, 50])) })
    )

    expect(uploadMock).toHaveBeenCalledTimes(1)
    expect(uploadMock.mock.calls[0][1]).toBe('tablemate/images')
    const uploadedFile = uploadMock.mock.calls[0][2] as File
    expect(Array.from(new Uint8Array(await uploadedFile.arrayBuffer()))).toEqual([10, 20, 30, 40, 50])
    expect(uploadedFile.name).toBe('ab.jpg')

    expect(createMock).toHaveBeenCalledTimes(1)
    const created = createMock.mock.calls[0][0] as {
      content: string
      flags: { tablemate: { imagePath: string; imageMimeType: string; imageWidth: number } }
    }
    // Content carries an <img> for Foundry's own log, wrapped so the app strips it.
    expect(created.content).toContain('<img')
    expect(created.content).toContain('data-tablemate-image')
    expect(created.content).toContain('tablemate/images/test-world/x.jpg')
    expect(created.flags.tablemate.imagePath).toBe('tablemate/images/test-world/x.jpg')
    expect(created.flags.tablemate.imageMimeType).toBe('image/jpeg')
    expect(created.flags.tablemate.imageWidth).toBe(800)
  })

  it('resolves whisper command targets to recipient ids like the text path', async () => {
    await foundrySendImage(
      chunkArgs({
        uploadId: 'whisper',
        chunkBase64: bytesToBase64(new Uint8Array([1, 2, 3])),
        whisper: ['gm', '[Bob]']
      })
    )
    const created = createMock.mock.calls[0][0] as { whisper?: string[] }
    expect(created.whisper).toEqual(['gm-1', 'user-2'])
  })

  it('scopes a private image to its author when no whisper target resolves', async () => {
    await foundrySendImage(
      chunkArgs({ uploadId: 'ghost', chunkBase64: bytesToBase64(new Uint8Array([1])), whisper: ['[Nobody]'] })
    )
    const created = createMock.mock.calls[0][0] as { whisper?: string[] }
    expect(created.whisper).toEqual(['user-1'])
  })

  it('rejects a chunk index outside the declared total', async () => {
    await expect(
      foundrySendImage(chunkArgs({ uploadId: 'bad', seq: 3, total: 2, chunkBase64: 'AA==' }))
    ).rejects.toThrow(/out of range/)
  })

  it('rejects a non-positive total', async () => {
    await expect(
      foundrySendImage(chunkArgs({ uploadId: 'bad2', seq: 0, total: 0, chunkBase64: 'AA==' }))
    ).rejects.toThrow(/invalid chunk count/)
  })

  it('refuses to upload when the world has no configured image folder', async () => {
    uploadFolder = ''
    await expect(
      foundrySendImage(chunkArgs({ uploadId: 'disabled', chunkBase64: bytesToBase64(new Uint8Array([1, 2, 3])) }))
    ).rejects.toThrow(/not enabled/)
    expect(uploadMock).not.toHaveBeenCalled()
    expect(createMock).not.toHaveBeenCalled()
  })
})
