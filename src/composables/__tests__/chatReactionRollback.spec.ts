// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, computed } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { readReactions } from '@/utils/chatReactions'
import type { ChatMessageData } from '@/composables/useChatMessages'

// A reaction can't be written directly — Foundry only lets a message's author
// update it — so it goes through the GM as an RPC and the chip is applied
// optimistically in the meantime. That optimism has to be undone when the RPC
// fails, and these cover what "undone" has to mean: our own tap reversed, on the
// list as it stands at that moment, without taking anyone else's reaction with
// it. The whole point of the round trip is that other people are reacting too.

const toggleReaction =
  vi.fn<(messageId: string, emoji: string) => Promise<{ reactions: unknown[] }>>()

vi.mock('@/api/actionRpc', () => ({
  applyDamage: vi.fn(),
  consumeItem: vi.fn(),
  rerollChatRoll: vi.fn(),
  sendImage: vi.fn(),
  sendVoiceMemo: vi.fn(),
  toggleReaction: (...args: Parameters<typeof toggleReaction>) => toggleReaction(...args)
}))
vi.mock('@/api/documents', () => ({ modifyDocument: vi.fn(async () => ({ result: [] })) }))
// Native-only side effect the composable pulls in transitively.
vi.mock('@/composables/useHapticFeedback', () => ({ triggerLightHapticFeedback: vi.fn() }))

const { useChatActions } = await import('@/composables/useChatActions')
const { useWorldStore } = await import('@/stores/world')
const { useUserStore } = await import('@/stores/user')

// One message in the world, reachable both as the object the row hands to
// toggleMessageReaction and as the copy the world store mutates in place.
function seedMessage() {
  const message = { _id: 'msg-1', flags: { tablemate: { reactions: [] } } }
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

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.stubGlobal('__APP_VERSION__', '0.0.0-test')
  setActivePinia(createPinia())
  useUserStore().setUserId('me')
})

describe('reaction rollback', () => {
  it('takes back only our own tap when another player reacted mid-flight', async () => {
    const message = seedMessage()
    const world = useWorldStore()
    const actions = makeActions(message)

    // Hold the RPC open so a broadcast can land while our tap is still out.
    let failRpc = () => {}
    toggleReaction.mockReturnValue(
      new Promise((_resolve, reject) => {
        failRpc = () => reject(new Error('no GM online'))
      })
    )

    const pending = actions.toggleMessageReaction(message, '👍')
    expect(readReactions(message)).toEqual([{ emoji: '👍', userId: 'me' }])

    // Another player reacts while we're waiting — the world broadcast arrives
    // and is applied on top of our optimistic chip.
    world.applyChatReactions('msg-1', [
      { emoji: '👍', userId: 'me' },
      { emoji: '❤️', userId: 'ezren' }
    ])

    failRpc()
    await pending

    // Ours is gone; Ezren's survives. Replaying the pre-tap snapshot instead
    // would have erased his until the next world refresh.
    expect(readReactions(message)).toEqual([{ emoji: '❤️', userId: 'ezren' }])
    expect(actions.actionError.value).toBe(true)
  })

  it('restores an un-react when the RPC fails', async () => {
    const message = seedMessage()
    useWorldStore().applyChatReactions('msg-1', [{ emoji: '👍', userId: 'me' }])
    const actions = makeActions(message)
    toggleReaction.mockRejectedValue(new Error('no GM online'))

    // Tapping our own chip removes it optimistically; the failure puts it back.
    await actions.toggleMessageReaction(message, '👍')
    expect(readReactions(message)).toEqual([{ emoji: '👍', userId: 'me' }])
  })

  it('settles on whatever the GM actually stored when the RPC succeeds', async () => {
    const message = seedMessage()
    const actions = makeActions(message)
    // The authoritative list can differ from our guess — someone else's reaction
    // landed on the GM between our read and its write.
    toggleReaction.mockResolvedValue({
      reactions: [
        { emoji: '👍', userId: 'me' },
        { emoji: '🎲', userId: 'valeros' }
      ]
    })

    await actions.toggleMessageReaction(message, '👍')

    expect(readReactions(message)).toEqual([
      { emoji: '👍', userId: 'me' },
      { emoji: '🎲', userId: 'valeros' }
    ])
    expect(actions.actionError.value).toBe(false)
  })
})
