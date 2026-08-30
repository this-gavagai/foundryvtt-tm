// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, computed } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { readComments } from '@/utils/chatComments'
import type { ChatMessageData } from '@/composables/useChatMessages'

// A comment can't be written directly: a roll made from the app is posted by the
// GM's client, so even its own roller isn't the message's author. The write goes
// through the GM as an RPC, and — unlike a reaction chip — is deliberately NOT
// optimistic: what the ack carries is what lands, because someone else may have
// commented on the same message while this one was being typed.
//
// Exercised through useChatActions, which is the chat log's caller; the write
// itself lives in useChatComments, which the roll-result panel uses directly.

const setComment =
  vi.fn<(messageId: string, text: string, commentId?: string) => Promise<{ comments: unknown[] }>>()

vi.mock('@/api/actionRpc', () => ({
  applyDamage: vi.fn(),
  consumeItem: vi.fn(),
  rerollChatRoll: vi.fn(),
  sendImage: vi.fn(),
  sendVoiceMemo: vi.fn(),
  toggleReaction: vi.fn(),
  setComment: (...args: Parameters<typeof setComment>) => setComment(...args)
}))
vi.mock('@/api/documents', () => ({ modifyDocument: vi.fn(async () => ({ result: [] })) }))
vi.mock('@/composables/useHapticFeedback', () => ({ triggerLightHapticFeedback: vi.fn() }))

const { useChatActions } = await import('@/composables/useChatActions')
const { useChatComments } = await import('@/composables/useChatComments')
const { useWorldStore } = await import('@/stores/world')
const { useUserStore } = await import('@/stores/user')

function seedMessage() {
  const message = { _id: 'msg-1', flags: { tablemate: { comments: [] } } }
  useWorldStore().world = { messages: [message] } as never
  return message as unknown as ChatMessageData
}

function makeActions(message: ChatMessageData) {
  return useChatActions({
    actorId: ref('seelah-id'),
    actor: ref(undefined),
    messages: computed<ChatMessageData[]>(() => [message]),
    messageIsOwnActor: () => true
  })
}

const STORED = [{ id: 'c1', userId: 'me', text: 'a called shot', timestamp: 1 }]

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.stubGlobal('__APP_VERSION__', '0.0.0-test')
  setActivePinia(createPinia())
  useUserStore().setUserId('me')
})

describe('saveComment', () => {
  it('writes back exactly the list the module stored', async () => {
    const message = seedMessage()
    const actions = makeActions(message)
    // The ack carries a comment this client never wrote — someone else remarked
    // the same roll mid-flight. It has to survive.
    setComment.mockResolvedValue({
      comments: [...STORED, { id: 'c2', userId: 'gm', text: 'and it lands', timestamp: 2 }]
    })

    await expect(actions.saveComment(message, 'a called shot')).resolves.toBe(true)

    expect(setComment).toHaveBeenCalledWith('msg-1', 'a called shot', undefined)
    expect(readComments(message).map((c) => c.id)).toEqual(['c1', 'c2'])
  })

  it('sanitizes before sending', async () => {
    const message = seedMessage()
    const actions = makeActions(message)
    setComment.mockResolvedValue({ comments: STORED })

    await actions.saveComment(message, '  a called shot  ')
    expect(setComment).toHaveBeenCalledWith('msg-1', 'a called shot', undefined)
  })

  it('names the comment being rewritten', async () => {
    const message = seedMessage()
    const actions = makeActions(message)
    setComment.mockResolvedValue({ comments: STORED })

    await actions.saveComment(message, 'rewritten', 'c1')
    expect(setComment).toHaveBeenCalledWith('msg-1', 'rewritten', 'c1')
  })

  it('sends nothing for an empty new comment', async () => {
    const message = seedMessage()
    const actions = makeActions(message)

    await expect(actions.saveComment(message, '   ')).resolves.toBe(false)
    expect(setComment).not.toHaveBeenCalled()
  })

  it('reports a failed write and leaves the comments as they were', async () => {
    const message = seedMessage()
    const actions = makeActions(message)
    setComment.mockRejectedValue(new Error('no GM online'))

    await expect(actions.saveComment(message, 'a called shot')).resolves.toBe(false)
    expect(actions.actionError.value).toBe(true)
    expect(actions.commentFailed.value).toBe(true)
    // Nothing was applied locally, so there is nothing to roll back.
    expect(readComments(message)).toEqual([])
  })

  it('clears a previous failure when the next write starts', async () => {
    // The editor stays open on a failure and reports it; retyping and saving
    // again must not leave the old error standing under the new attempt.
    const message = seedMessage()
    const actions = makeActions(message)
    setComment.mockRejectedValueOnce(new Error('no GM online'))
    await actions.saveComment(message, 'a called shot')
    expect(actions.commentFailed.value).toBe(true)

    setComment.mockResolvedValue({ comments: STORED })
    await expect(actions.saveComment(message, 'a called shot')).resolves.toBe(true)
    expect(actions.commentFailed.value).toBe(false)
  })

  it('refuses a second write while one is in flight', async () => {
    const message = seedMessage()
    const actions = makeActions(message)
    let release: (value: { comments: unknown[] }) => void = () => {}
    setComment.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      })
    )

    const first = actions.saveComment(message, 'a called shot')
    expect(actions.isCommentPending('msg-1')).toBe(true)
    // A double-tap on Save must not post the comment twice.
    await expect(actions.saveComment(message, 'a called shot')).resolves.toBe(false)
    expect(setComment).toHaveBeenCalledTimes(1)

    release({ comments: STORED })
    await first
    expect(actions.isCommentPending('msg-1')).toBe(false)
  })

  it('removes a comment by writing it empty', async () => {
    const message = seedMessage()
    const actions = makeActions(message)
    setComment.mockResolvedValue({ comments: [] })

    await expect(actions.removeComment(message, 'c1')).resolves.toBe(true)
    expect(setComment).toHaveBeenCalledWith('msg-1', '', 'c1')
  })
})

// The roll-result panel calls the composable directly — it is a leaf on a
// character sheet, with no chat surface to hang the write on — and needs the
// stored list back rather than a bare boolean: it offers a comment on a card
// that may not have reached the app's message cache yet, so the ack is the only
// place it can learn which comment it just wrote.
describe('useChatComments', () => {
  it('hands back the list the module stored', async () => {
    seedMessage()
    const comments = useChatComments()
    setComment.mockResolvedValue({ comments: STORED })

    await expect(comments.saveComment('msg-1', 'a called shot')).resolves.toEqual(STORED)
  })

  it('answers null when the write failed', async () => {
    seedMessage()
    const comments = useChatComments()
    setComment.mockRejectedValue(new Error('no GM online'))

    await expect(comments.saveComment('msg-1', 'a called shot')).resolves.toBeNull()
    expect(comments.commentFailed.value).toBe(true)
  })

  it('answers null without a message to comment on', async () => {
    const comments = useChatComments()
    await expect(comments.saveComment(undefined, 'a called shot')).resolves.toBeNull()
    expect(setComment).not.toHaveBeenCalled()
  })
})
