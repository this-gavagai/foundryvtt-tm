// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, computed } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { ChatMessageData } from '@/composables/useChatMessages'

// The app transcribes the memos it records and patches the text onto the posted
// message itself (it authored it, so Foundry lets it). These pin the parts that
// only fail in production otherwise: that the memo is never held up waiting for
// the transcription, that the sender declares the pending transcript so the push
// notifier waits for it, and that the patch writes the transcript WITHOUT
// clobbering the flags the memo's own player is rendered from.

type VoiceMemoAck = { messageId?: string; content?: string }
type MemoSendMeta = { transcriptPending?: boolean }

const sendVoiceMemo = vi.fn<
  (characterId: string, chunk: unknown, meta: MemoSendMeta) => Promise<VoiceMemoAck>
>(async () => ({ messageId: 'msg-1', content: '<audio></audio>' }))
const modifyDocument = vi.fn<
  (payload: unknown, onResponse?: (r: unknown) => void) => Promise<unknown>
>(async (_payload, onResponse) => {
  onResponse?.({ result: [] })
  return { result: [] }
})
const transcribeAudioOrNull = vi.fn<
  (blob: Blob, mimeType: string, config: unknown) => Promise<string | null>
>(async () => 'the goblin attacks')

vi.mock('@/api/actionRpc', () => ({
  applyDamage: vi.fn(),
  consumeItem: vi.fn(),
  rerollChatRoll: vi.fn(),
  sendImage: vi.fn(),
  sendVoiceMemo: (...args: Parameters<typeof sendVoiceMemo>) => sendVoiceMemo(...args),
  toggleReaction: vi.fn()
}))
vi.mock('@/api/documents', () => ({
  modifyDocument: (...args: Parameters<typeof modifyDocument>) => modifyDocument(...args)
}))
vi.mock('@/api/transcription', async (importActual) => ({
  ...(await importActual<typeof import('@/api/transcription')>()),
  transcribeAudioOrNull: (...args: Parameters<typeof transcribeAudioOrNull>) =>
    transcribeAudioOrNull(...args)
}))
// Native-only side effects the composable pulls in transitively.
vi.mock('@/composables/useHapticFeedback', () => ({ triggerLightHapticFeedback: vi.fn() }))

const { useChatActions } = await import('@/composables/useChatActions')
const { useSettingsStore } = await import('@/stores/settings')
const { useWorldStore } = await import('@/stores/world')
const { useVersionCompatStore } = await import('@/stores/versionCompat')
const { PROTOCOL_VERSION, CAPABILITY_VOICE_MEMO_TRANSCRIPT } = await import('@/api/protocol')

function makeActions() {
  return useChatActions({
    actorId: ref('seelah-id'),
    actor: ref(undefined),
    messages: computed<ChatMessageData[]>(() => []),
    messageIsOwnActor: () => true
  })
}

// Configure this device to transcribe. The key setter is async (keystore), so
// tests await it before recording.
async function enableTranscription() {
  const settings = useSettingsStore()
  settings.transcriptionEnabled = true
  settings.transcriptionEndpoint = 'https://api.openai.com/v1'
  settings.transcriptionModel = 'whisper-1'
  await settings.setTranscriptionApiKey('sk-test')
  connectModule([CAPABILITY_VOICE_MEMO_TRANSCRIPT])
}

// Stand in for the module's LISTENER_ONLINE handshake, whose capability list
// says whether the memo ack will name the posted message.
function connectModule(capabilities: string[]) {
  useVersionCompatStore().reportModule(PROTOCOL_VERSION, '1.0.0', capabilities)
}

const memo = { mimeType: 'audio/mp4', durationMs: 1200 }

function blob(): Blob {
  return new Blob([new Uint8Array([1, 2, 3])])
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  // Build-time define (vite.config.mts) the version store reads; vitest doesn't
  // run that transform, so stand it up as a plain global.
  vi.stubGlobal('__APP_VERSION__', '0.0.0-test')
  setActivePinia(createPinia())
  sendVoiceMemo.mockResolvedValue({ messageId: 'msg-1', content: '<audio></audio>' })
  transcribeAudioOrNull.mockResolvedValue('the goblin attacks')
})

describe('submitVoiceMemo transcription', () => {
  it('does not transcribe when this device has no transcription configured', async () => {
    connectModule([CAPABILITY_VOICE_MEMO_TRANSCRIPT])
    await makeActions().submitVoiceMemo(blob(), memo)

    expect(sendVoiceMemo).toHaveBeenCalledTimes(1)
    expect(transcribeAudioOrNull).not.toHaveBeenCalled()
    // No transcript is coming, so the push notifier must not wait for one.
    expect(sendVoiceMemo.mock.calls[0][2]).toMatchObject({ transcriptPending: false })
    await vi.waitFor(() => expect(modifyDocument).not.toHaveBeenCalled())
  })

  it('spends no transcription call on a module that cannot report the message', async () => {
    await enableTranscription()
    connectModule([]) // older module: acks the upload, names no message

    await makeActions().submitVoiceMemo(blob(), memo)

    expect(sendVoiceMemo).toHaveBeenCalledTimes(1)
    expect(transcribeAudioOrNull).not.toHaveBeenCalled()
    expect(sendVoiceMemo.mock.calls[0][2]).toMatchObject({ transcriptPending: false })
  })

  it('transcribes as soon as the recording finishes, before anything is sent', async () => {
    await enableTranscription()
    const actions = makeActions()
    const take = blob()

    // What the composer does the moment the recorder produces its blob.
    actions.beginVoiceMemoTranscription(take, 'audio/mp4')
    expect(transcribeAudioOrNull).toHaveBeenCalledTimes(1)
    expect(sendVoiceMemo).not.toHaveBeenCalled()

    // Sending reuses that call rather than starting a second one.
    await actions.submitVoiceMemo(take, memo)
    expect(transcribeAudioOrNull).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(modifyDocument).toHaveBeenCalledTimes(1))
  })

  it('exposes the transcript for the composer to show under the take', async () => {
    await enableTranscription()
    const actions = makeActions()
    let finishTranscription = (_text: string | null) => {}
    transcribeAudioOrNull.mockReturnValue(
      new Promise<string | null>((resolve) => {
        finishTranscription = resolve
      })
    )

    actions.beginVoiceMemoTranscription(blob(), 'audio/mp4')
    expect(actions.voiceMemoTranscribing.value).toBe(true)
    expect(actions.voiceMemoTranscript.value).toBeNull()

    finishTranscription('the goblin attacks')
    await vi.waitFor(() => expect(actions.voiceMemoTranscript.value).toBe('the goblin attacks'))
    expect(actions.voiceMemoTranscribing.value).toBe(false)

    // Discarding the take clears the preview with it.
    actions.discardVoiceMemoTranscription()
    expect(actions.voiceMemoTranscript.value).toBeNull()
    expect(actions.voiceMemoTranscribing.value).toBe(false)
  })

  it('sends the user’s correction rather than what was transcribed', async () => {
    await enableTranscription()
    const actions = makeActions()
    const take = blob()
    actions.beginVoiceMemoTranscription(take, 'audio/mp4')
    await vi.waitFor(() => expect(actions.voiceMemoTranscript.value).toBe('the goblin attacks'))

    actions.setVoiceMemoTranscript('  the hobgoblin attacks  ')
    expect(actions.voiceMemoTranscript.value).toBe('the hobgoblin attacks')

    await actions.submitVoiceMemo(take, memo)
    await vi.waitFor(() => expect(modifyDocument).toHaveBeenCalledTimes(1))
    const update = (
      modifyDocument.mock.calls[0][0] as {
        operation: { updates: Array<Record<string, unknown>> }
      }
    ).operation.updates[0]
    expect(update.flags).toEqual({ tablemate: { transcript: 'the hobgoblin attacks' } })
  })

  it('treats an emptied transcript as “send this memo without text”', async () => {
    await enableTranscription()
    const actions = makeActions()
    const take = blob()
    actions.beginVoiceMemoTranscription(take, 'audio/mp4')
    await vi.waitFor(() => expect(actions.voiceMemoTranscript.value).toBe('the goblin attacks'))

    actions.setVoiceMemoTranscript('   ')
    expect(actions.voiceMemoTranscript.value).toBeNull()

    await actions.submitVoiceMemo(take, memo)
    // Nothing is coming, so the push notifier must not be told to wait either.
    expect(sendVoiceMemo.mock.calls[0][2]).toMatchObject({ transcriptPending: false })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(modifyDocument).not.toHaveBeenCalled()
  })

  it('keeps a correction typed while the transcription was still out', async () => {
    await enableTranscription()
    const actions = makeActions()
    let finishTranscription = (_text: string | null) => {}
    transcribeAudioOrNull.mockReturnValue(
      new Promise<string | null>((resolve) => {
        finishTranscription = resolve
      })
    )
    actions.beginVoiceMemoTranscription(blob(), 'audio/mp4')

    actions.setVoiceMemoTranscript('typed by hand')
    finishTranscription('the goblin attacks')

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(actions.voiceMemoTranscript.value).toBe('typed by hand')
    expect(actions.voiceMemoTranscribing.value).toBe(false)
  })

  it('shows nothing under the take when the transcription failed', async () => {
    await enableTranscription()
    const actions = makeActions()
    transcribeAudioOrNull.mockResolvedValue(null)

    actions.beginVoiceMemoTranscription(blob(), 'audio/mp4')

    await vi.waitFor(() => expect(actions.voiceMemoTranscribing.value).toBe(false))
    expect(actions.voiceMemoTranscript.value).toBeNull()
  })

  it('never surfaces a discarded take’s text under the take that replaced it', async () => {
    await enableTranscription()
    const actions = makeActions()
    let finishFirst = (_text: string | null) => {}
    transcribeAudioOrNull.mockReturnValue(
      new Promise<string | null>((resolve) => {
        finishFirst = resolve
      })
    )
    actions.beginVoiceMemoTranscription(blob(), 'audio/mp4')

    // Retake while the first call is still out.
    transcribeAudioOrNull.mockResolvedValue('the second take')
    actions.beginVoiceMemoTranscription(blob(), 'audio/mp4')
    finishFirst('the first take')

    await vi.waitFor(() => expect(actions.voiceMemoTranscript.value).toBe('the second take'))
  })

  it('does not attach a discarded take’s transcription to the next memo', async () => {
    await enableTranscription()
    const actions = makeActions()

    actions.beginVoiceMemoTranscription(blob(), 'audio/mp4') // take the user retakes
    actions.discardVoiceMemoTranscription()
    transcribeAudioOrNull.mockResolvedValue('the second take')

    await actions.submitVoiceMemo(blob(), memo)

    await vi.waitFor(() => expect(modifyDocument).toHaveBeenCalledTimes(1))
    const update = (
      modifyDocument.mock.calls[0][0] as {
        operation: { updates: Array<Record<string, unknown>> }
      }
    ).operation.updates[0]
    expect(update.flags).toEqual({ tablemate: { transcript: 'the second take' } })
  })

  it('honors transcription being switched off between recording and sending', async () => {
    await enableTranscription()
    const actions = makeActions()
    const take = blob()
    actions.beginVoiceMemoTranscription(take, 'audio/mp4')

    useSettingsStore().transcriptionEnabled = false
    await actions.submitVoiceMemo(take, memo)

    expect(sendVoiceMemo.mock.calls[0][2]).toMatchObject({ transcriptPending: false })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(modifyDocument).not.toHaveBeenCalled()
  })

  it('patches the transcript onto the posted message, flag and content both', async () => {
    await enableTranscription()
    await makeActions().submitVoiceMemo(blob(), memo)

    expect(transcribeAudioOrNull).toHaveBeenCalledTimes(1)
    expect(sendVoiceMemo.mock.calls[0][2]).toMatchObject({ transcriptPending: true })

    // The patch lands after the memo has posted.
    await vi.waitFor(() => expect(modifyDocument).toHaveBeenCalledTimes(1))
    const payload = modifyDocument.mock.calls[0][0] as {
      action: string
      type: string
      operation: { updates: Array<Record<string, unknown>> }
    }
    expect(payload.action).toBe('update')
    expect(payload.type).toBe('ChatMessage')
    const update = payload.operation.updates[0]
    expect(update._id).toBe('msg-1')
    expect(update.flags).toEqual({ tablemate: { transcript: 'the goblin attacks' } })
    // Content copy for Foundry's own chat log, wrapped so the app strips it.
    expect(update.content).toBe(
      '<audio></audio><div data-tablemate-transcript><em>the goblin attacks</em></div>'
    )
  })

  it('sends the memo without waiting for the transcription to finish', async () => {
    await enableTranscription()
    let finishTranscription = (_text: string | null) => {}
    transcribeAudioOrNull.mockReturnValue(
      new Promise<string | null>((resolve) => {
        finishTranscription = resolve
      })
    )

    await makeActions().submitVoiceMemo(blob(), memo)

    // Posted already, with nothing patched on yet.
    expect(sendVoiceMemo).toHaveBeenCalledTimes(1)
    expect(modifyDocument).not.toHaveBeenCalled()

    finishTranscription('the goblin attacks')
    await vi.waitFor(() => expect(modifyDocument).toHaveBeenCalledTimes(1))
  })

  it('leaves the memo audio-only when the transcription fails', async () => {
    await enableTranscription()
    transcribeAudioOrNull.mockResolvedValue(null)

    await makeActions().submitVoiceMemo(blob(), memo)

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(modifyDocument).not.toHaveBeenCalled()
  })

  it('drops the transcript when the module reported no message id', async () => {
    await enableTranscription()
    // An older module acks the final chunk without naming the posted message.
    sendVoiceMemo.mockResolvedValue({} as { messageId: string; content: string })

    await makeActions().submitVoiceMemo(blob(), memo)

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(modifyDocument).not.toHaveBeenCalled()
  })

  it('writes the local copy without dropping the memo’s other flags', async () => {
    await enableTranscription()
    const world = useWorldStore()
    const message = {
      _id: 'msg-1',
      content: '<audio></audio>',
      flags: { tablemate: { audioPath: 'audio/memo.m4a' } }
    }
    world.world = { messages: [message] } as never

    await makeActions().submitVoiceMemo(blob(), memo)
    await vi.waitFor(() => expect(modifyDocument).toHaveBeenCalledTimes(1))

    expect(message.flags.tablemate).toEqual({
      audioPath: 'audio/memo.m4a',
      transcript: 'the goblin attacks'
    })
    expect(message.content).toContain('data-tablemate-transcript')
  })
})
