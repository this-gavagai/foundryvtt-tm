// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, computed } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { ChatMessageData } from '@/composables/useChatMessages'

// A comment is stored on its AUTHOR's own user document, which Foundry lets them
// write — so the write is direct, with no GM in the loop (utils/chatComments.ts).
//
// It could not always be: on the message, a comment was a write to someone
// else's document, and sharply so, because a roll made from the app is posted by
// the GM's client, making the GM its author. Not even the roller owned their own
// roll's message.
//
// Two invariants moved as a result, and these cover both:
//
//   • the "only its author may rewrite it" rule is gone from the code, because
//     it is now Foundry's document permission — a player cannot write another
//     user's document at all;
//   • there is no authoritative list handed back to reconcile against, since
//     this document has one writer. What the caller reads back is the whole
//     THREAD, assembled across every author's document.
//
// Exercised through useChatActions, which is the chat log's caller; the write
// itself lives in useChatComments, which the roll-result panel uses directly.

const updateUserFlag = vi.fn<(userId: string, key: string, value: unknown) => Promise<unknown>>()

vi.mock('@/api/actionRpc', () => ({
  applyDamage: vi.fn(),
  consumeItem: vi.fn(),
  rerollChatRoll: vi.fn(),
  selectSpellVariant: vi.fn(),
  sendImage: vi.fn(),
  sendVoiceMemo: vi.fn()
}))
vi.mock('@/api/documents', () => ({
  modifyDocument: vi.fn(async () => ({ result: [] })),
  updateUserFlag: (...args: Parameters<typeof updateUserFlag>) => updateUserFlag(...args)
}))
vi.mock('@/composables/useHapticFeedback', () => ({ triggerLightHapticFeedback: vi.fn() }))

const { useChatActions } = await import('@/composables/useChatActions')
const { useChatComments } = await import('@/composables/useChatComments')
const { useWorldStore } = await import('@/stores/world')
const { useUserStore } = await import('@/stores/user')

function seedWorld() {
  const message = { _id: 'msg-1', flags: {} }
  useWorldStore().world = {
    messages: [message],
    users: [
      { _id: 'me', name: 'Me', flags: {} },
      { _id: 'gm', name: 'GM', flags: {} }
    ],
    settings: [{ key: 'tablemate.commentsEnabled', value: 'true', user: null }]
  } as never
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

/** The comment list written to `me`'s document by the last call. */
function written(): { id: string; messageId: string; text: string }[] {
  const call = updateUserFlag.mock.calls.at(-1)
  return (call?.[2] ?? []) as { id: string; messageId: string; text: string }[]
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.stubGlobal('__APP_VERSION__', '0.0.0-test')
  setActivePinia(createPinia())
  useUserStore().setUserId('me')
  updateUserFlag.mockResolvedValue(undefined)
})

describe('saveComment', () => {
  it('writes the author’s own user document, not the message', async () => {
    const message = seedWorld()
    const actions = makeActions(message)

    await expect(actions.saveComment(message, 'a called shot')).resolves.toBe(true)

    const [userId, key] = updateUserFlag.mock.calls[0]
    expect(userId).toBe('me')
    expect(key).toBe('comments')
    expect(written()).toEqual([
      expect.objectContaining({ messageId: 'msg-1', text: 'a called shot' })
    ])
    // Nothing was written to the message — that is what used to need a GM.
    expect(message.flags).toEqual({})
  })

  it('reads back the whole thread, not just our own half', async () => {
    seedWorld()
    const world = useWorldStore()
    // The GM remarked on the same roll a minute ago, on their own document.
    world.applyUserAnnotations('gm', 'comments', [
      { id: 'c-gm', messageId: 'msg-1', text: 'it lands', timestamp: Date.now() - 60_000 }
    ])
    const comments = useChatComments()

    const thread = await comments.saveComment('msg-1', 'a called shot')

    // Both authors' comments, in the order they were said. Cross-author
    // ordering comes from the clock — the only thing relating entries written
    // to two different documents — so the GM's earlier remark leads.
    expect(thread?.map((c) => c.userId)).toEqual(['gm', 'me'])
    expect(thread?.map((c) => c.text)).toEqual(['it lands', 'a called shot'])
  })

  it('sanitizes before writing', async () => {
    const message = seedWorld()
    const actions = makeActions(message)

    await actions.saveComment(message, '  a called shot  ')
    expect(written()[0].text).toBe('a called shot')
  })

  it('rewrites the comment it names, keeping its original timestamp', async () => {
    const message = seedWorld()
    const world = useWorldStore()
    world.applyUserAnnotations('me', 'comments', [
      { id: 'c1', messageId: 'msg-1', text: 'a called shot', timestamp: 5 }
    ])
    const actions = makeActions(message)

    await actions.saveComment(message, 'rewritten', 'c1')

    // One entry, not two — and it keeps its place in the thread, which is what
    // its timestamp means.
    expect(written()).toEqual([{ id: 'c1', messageId: 'msg-1', text: 'rewritten', timestamp: 5 }])
  })

  // Editing addresses a comment on OUR OWN document, so an id we do not hold is
  // a stale editor or someone else's comment. Neither is ours to write, and
  // adding a second comment instead would be worse than refusing.
  it('refuses to edit a comment this user does not hold', async () => {
    const message = seedWorld()
    const actions = makeActions(message)

    await expect(actions.saveComment(message, 'rewritten', 'not-mine')).resolves.toBe(false)
    expect(updateUserFlag).not.toHaveBeenCalled()
    expect(actions.commentFailed.value).toBe(true)
  })

  it('writes nothing for an empty new comment', async () => {
    const message = seedWorld()
    const actions = makeActions(message)

    await expect(actions.saveComment(message, '   ')).resolves.toBe(false)
    expect(updateUserFlag).not.toHaveBeenCalled()
  })

  it('reports a failed write and leaves the thread as it was', async () => {
    const message = seedWorld()
    const world = useWorldStore()
    const actions = makeActions(message)
    updateUserFlag.mockRejectedValue(new Error('write refused'))

    await expect(actions.saveComment(message, 'a called shot')).resolves.toBe(false)
    expect(actions.actionError.value).toBe(true)
    expect(actions.commentFailed.value).toBe(true)
    // Not applied locally until the write lands, so there is nothing to undo.
    expect(world.commentsFor('msg-1')).toEqual([])
  })

  it('clears a previous failure when the next write starts', async () => {
    const message = seedWorld()
    const actions = makeActions(message)
    updateUserFlag.mockRejectedValueOnce(new Error('write refused'))
    await actions.saveComment(message, 'a called shot')
    expect(actions.commentFailed.value).toBe(true)

    updateUserFlag.mockResolvedValue(undefined)
    await expect(actions.saveComment(message, 'a called shot')).resolves.toBe(true)
    expect(actions.commentFailed.value).toBe(false)
  })

  it('refuses a second write while one is in flight', async () => {
    const message = seedWorld()
    const actions = makeActions(message)
    let release: () => void = () => {}
    updateUserFlag.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve(undefined)
      })
    )

    const first = actions.saveComment(message, 'a called shot')
    expect(actions.isCommentPending('msg-1')).toBe(true)
    // A double-tap on Save must not post the comment twice.
    await expect(actions.saveComment(message, 'a called shot')).resolves.toBe(false)
    expect(updateUserFlag).toHaveBeenCalledTimes(1)

    release()
    await first
    expect(actions.isCommentPending('msg-1')).toBe(false)
  })

  it('removes a comment by writing it out of the list', async () => {
    const message = seedWorld()
    const world = useWorldStore()
    world.applyUserAnnotations('me', 'comments', [
      { id: 'c1', messageId: 'msg-1', text: 'a called shot', timestamp: 1 }
    ])
    const actions = makeActions(message)

    await expect(actions.removeComment(message, 'c1')).resolves.toBe(true)
    expect(written()).toEqual([])
  })

  it('leaves this user’s comments on other messages alone', async () => {
    const message = seedWorld()
    const world = useWorldStore()
    world.applyUserAnnotations('me', 'comments', [
      { id: 'c0', messageId: 'msg-0', text: 'earlier', timestamp: 1 }
    ])
    const actions = makeActions(message)

    await actions.saveComment(message, 'a called shot')

    // The whole list is rewritten on every save, so the entries for other
    // messages have to survive it.
    expect(written().map((c) => c.messageId)).toEqual(['msg-0', 'msg-1'])
  })
})

// The roll-result panel calls the composable directly — it is a leaf on a
// character sheet, with no chat surface to hang the write on — and needs the
// thread back rather than a bare boolean: it offers a comment on a card that may
// not have reached the app's message cache yet, and the index is keyed by
// message id, so it resolves anyway.
describe('useChatComments', () => {
  it('hands back the thread for a message the app has not cached', async () => {
    useWorldStore().world = {
      messages: [],
      users: [{ _id: 'me', name: 'Me', flags: {} }],
      settings: []
    } as never
    const comments = useChatComments()

    const thread = await comments.saveComment('uncached-msg', 'a called shot')
    expect(thread).toEqual([expect.objectContaining({ userId: 'me', text: 'a called shot' })])
  })

  it('answers null when the write failed', async () => {
    seedWorld()
    const comments = useChatComments()
    updateUserFlag.mockRejectedValue(new Error('write refused'))

    await expect(comments.saveComment('msg-1', 'a called shot')).resolves.toBeNull()
    expect(comments.commentFailed.value).toBe(true)
  })

  it('answers null without a message to comment on', async () => {
    seedWorld()
    const comments = useChatComments()
    await expect(comments.saveComment(undefined, 'a called shot')).resolves.toBeNull()
    expect(updateUserFlag).not.toHaveBeenCalled()
  })
})

// Moderation is the one case where the writer and the author differ. Foundry
// allows it — a GM may update any User — but only if the write is addressed at
// the document that actually holds the comment. Addressing our own instead is
// how it used to fail: the affordance was offered, and this file refused it
// before the server could allow it.
describe('a GM moderating someone else’s comment', () => {
  beforeEach(() => {
    useUserStore().setUserId('gm')
  })

  it('rewrites it on its author’s document, not the GM’s own', async () => {
    seedWorld()
    const world = useWorldStore()
    world.applyUserAnnotations('me', 'comments', [
      { id: 'c1', messageId: 'msg-1', text: 'unkind', timestamp: 5 }
    ])
    const comments = useChatComments()

    const thread = await comments.saveComment('msg-1', 'redacted', 'c1')

    const [userId, key] = updateUserFlag.mock.calls[0]
    expect(userId).toBe('me')
    expect(key).toBe('comments')
    // Edited in place, keeping its timestamp — moderation is a rewrite, not a
    // new remark posted under the GM's name.
    expect(written()).toEqual([{ id: 'c1', messageId: 'msg-1', text: 'redacted', timestamp: 5 }])
    expect(thread).toEqual([expect.objectContaining({ userId: 'me', text: 'redacted' })])
  })

  it('removes it from its author’s document', async () => {
    seedWorld()
    const world = useWorldStore()
    world.applyUserAnnotations('me', 'comments', [
      { id: 'c1', messageId: 'msg-1', text: 'unkind', timestamp: 5 }
    ])
    const comments = useChatComments()

    await expect(comments.removeComment('msg-1', 'c1')).resolves.toEqual([])
    expect(updateUserFlag.mock.calls[0][0]).toBe('me')
    expect(written()).toEqual([])
  })

  it('leaves the author’s comments on other messages alone', async () => {
    seedWorld()
    const world = useWorldStore()
    world.applyUserAnnotations('me', 'comments', [
      { id: 'c0', messageId: 'msg-0', text: 'elsewhere', timestamp: 1 },
      { id: 'c1', messageId: 'msg-1', text: 'unkind', timestamp: 5 }
    ])
    const comments = useChatComments()

    await comments.removeComment('msg-1', 'c1')

    // The whole list is rewritten, so moderating one remark must not take the
    // author's unrelated ones with it.
    expect(written().map((c) => c.id)).toEqual(['c0'])
  })

  it('still writes a NEW comment as the GM, not as the thread’s author', async () => {
    seedWorld()
    const world = useWorldStore()
    world.applyUserAnnotations('me', 'comments', [
      { id: 'c1', messageId: 'msg-1', text: 'unkind', timestamp: 5 }
    ])
    const comments = useChatComments()

    await comments.saveComment('msg-1', 'watch your tone')

    expect(updateUserFlag.mock.calls[0][0]).toBe('gm')
    expect(written()).toEqual([
      expect.objectContaining({ messageId: 'msg-1', text: 'watch your tone' })
    ])
  })

  // A comment an older build wrote onto the MESSAGE reads back with an author,
  // so the thread offers it — but it sits on no user document, and writing the
  // author's list would add a duplicate beside the one still on the message.
  it('refuses a comment that lives on the message rather than on a user', async () => {
    const message = seedWorld()
    ;(message as { flags: Record<string, unknown> }).flags = {
      tablemate: {
        comments: [{ id: 'legacy-1', userId: 'me', text: 'from an older build', timestamp: 5 }]
      }
    }
    useWorldStore().bumpMessagesRevision()
    const comments = useChatComments()

    await expect(comments.saveComment('msg-1', 'redacted', 'legacy-1')).resolves.toBeNull()
    expect(updateUserFlag).not.toHaveBeenCalled()
    expect(comments.commentFailed.value).toBe(true)
  })
})
