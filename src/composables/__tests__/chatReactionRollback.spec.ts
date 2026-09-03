// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, computed } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { ChatMessageData } from '@/composables/useChatMessages'

// A reaction is stored on the REACTOR's own user document, which Foundry lets
// them write — so the tap is a direct socket write with no GM in the loop
// (utils/chatReactions.ts). The chip is still applied optimistically, for
// latency, and that optimism still has to be undone when the write fails.
//
// What changed, and what these cover: the RPC version had to RECONCILE, because
// the GM's copy of a message's reaction list could have moved under it while the
// request was out. This list has exactly one writer, so there is nothing to
// reconcile and nothing to race — a failure restores precisely what was there,
// and another player's reaction cannot be caught up in it because it lives on
// their document, not ours.

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
// Native-only side effect the composable pulls in transitively.
vi.mock('@/composables/useHapticFeedback', () => ({ triggerLightHapticFeedback: vi.fn() }))

const { useChatActions } = await import('@/composables/useChatActions')
const { useWorldStore } = await import('@/stores/world')
const { useUserStore } = await import('@/stores/user')

// One message and two users in the world. Reactions are read back through the
// store's cross-user index rather than off the message, which is the whole
// shape of the change.
function seedWorld() {
  const message = { _id: 'msg-1', flags: {} }
  useWorldStore().world = {
    messages: [message],
    users: [
      { _id: 'me', name: 'Me', flags: {} },
      { _id: 'ezren', name: 'Ezren', flags: {} }
    ],
    settings: [{ key: 'tablemate.reactionsEnabled', value: 'true', user: null }]
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

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.stubGlobal('__APP_VERSION__', '0.0.0-test')
  setActivePinia(createPinia())
  useUserStore().setUserId('me')
  updateUserFlag.mockResolvedValue(undefined)
})

describe('reaction toggle', () => {
  it('writes the reactor’s own user document, not the message', async () => {
    const message = seedWorld()
    const actions = makeActions(message)

    await actions.toggleMessageReaction(message, '👍')

    expect(updateUserFlag).toHaveBeenCalledWith('me', 'reactions', [
      { messageId: 'msg-1', emoji: '👍' }
    ])
    // Nothing was written to the message — that is what used to need a GM.
    expect(message.flags).toEqual({})
  })

  it('shows the chip immediately and keeps it once the write lands', async () => {
    const message = seedWorld()
    const world = useWorldStore()
    const actions = makeActions(message)

    let settle = () => {}
    updateUserFlag.mockReturnValue(
      new Promise((resolve) => {
        settle = () => resolve(undefined)
      })
    )

    const pending = actions.toggleMessageReaction(message, '👍')
    expect(world.reactionsFor('msg-1')).toEqual([{ emoji: '👍', userId: 'me' }])

    settle()
    await pending
    expect(world.reactionsFor('msg-1')).toEqual([{ emoji: '👍', userId: 'me' }])
    expect(actions.actionError.value).toBe(false)
  })

  it('restores exactly what was there when the write fails', async () => {
    const message = seedWorld()
    const world = useWorldStore()
    // We already hold a reaction on another message; a failed tap must not
    // disturb it.
    world.applyUserAnnotations('me', 'reactions', [{ messageId: 'msg-0', emoji: '🎲' }])
    const actions = makeActions(message)
    updateUserFlag.mockRejectedValue(new Error('write refused'))

    await actions.toggleMessageReaction(message, '👍')

    expect(world.reactionsFor('msg-1')).toEqual([])
    expect(world.reactionsFor('msg-0')).toEqual([{ emoji: '🎲', userId: 'me' }])
    expect(actions.actionError.value).toBe(true)
  })

  it('restores an un-react when the write fails', async () => {
    const message = seedWorld()
    const world = useWorldStore()
    world.applyUserAnnotations('me', 'reactions', [{ messageId: 'msg-1', emoji: '👍' }])
    const actions = makeActions(message)
    updateUserFlag.mockRejectedValue(new Error('write refused'))

    // Tapping our own chip removes it optimistically; the failure puts it back.
    await actions.toggleMessageReaction(message, '👍')
    expect(world.reactionsFor('msg-1')).toEqual([{ emoji: '👍', userId: 'me' }])
  })

  // The case the RPC version needed a reconcile step for. Now it is structural:
  // another player's reaction is on another document, so our failure cannot
  // touch it and our success cannot overwrite it.
  it('leaves another player’s reaction alone through a failed tap', async () => {
    const message = seedWorld()
    const world = useWorldStore()
    const actions = makeActions(message)
    updateUserFlag.mockRejectedValue(new Error('write refused'))

    const pending = actions.toggleMessageReaction(message, '👍')
    // Ezren reacts while our write is out — a User broadcast, applied on top.
    world.applyUserAnnotations('ezren', 'reactions', [{ messageId: 'msg-1', emoji: '❤️' }])
    await pending

    expect(world.reactionsFor('msg-1')).toEqual([{ emoji: '❤️', userId: 'ezren' }])
  })

  it('reads reactions still stored on a message by an older build', () => {
    const message = seedWorld()
    const world = useWorldStore()
    // What a pre-rollover app wrote, via the GM, onto the message itself.
    world.applyChatReactions('msg-1', [{ emoji: '🎉', userId: 'valeros' }])
    world.applyUserAnnotations('me', 'reactions', [{ messageId: 'msg-1', emoji: '👍' }])

    // Both, not one or the other: during a rollover a message can carry each.
    expect(world.reactionsFor('msg-1')).toEqual(
      expect.arrayContaining([
        { emoji: '👍', userId: 'me' },
        { emoji: '🎉', userId: 'valeros' }
      ])
    )
    expect(world.reactionsFor('msg-1')).toHaveLength(2)
    void message
  })
})
