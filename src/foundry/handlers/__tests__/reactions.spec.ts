import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TM } from '@/api/protocol'
import { REACTION_EMOJI } from '@/utils/chatReactions'
import type { ToggleReactionArgs } from '@/types/api-types'

const [THUMB, HEART] = REACTION_EMOJI

// getGame is the only Foundry global the handler touches; mock it and leave the
// rest of the util module (makeAck) real so the ack shape is exercised too.
type StoredMessage = {
  flags: { tablemate: Record<string, unknown> }
  setFlag: (scope: string, key: string, value: unknown) => Promise<unknown>
}
let message: StoredMessage | undefined

const setFlagMock = vi.fn(async (scope: string, key: string, value: unknown) => {
  // Stand in for Foundry writing the flag back onto the document, so a second
  // toggle in the same test reads the result of the first.
  if (message) message.flags.tablemate[key] = value
  return {}
})

function makeMessage(reactions?: unknown): StoredMessage {
  return {
    flags: { tablemate: reactions === undefined ? {} : { reactions } },
    setFlag: setFlagMock
  }
}

const fakeGame = { messages: { get: vi.fn(() => message) } }
vi.mock('@/foundry/utils/foundry', async (importActual) => {
  const actual = await importActual<typeof import('@/foundry/utils/foundry')>()
  return { ...actual, getGame: vi.fn(() => fakeGame) }
})

const { foundryToggleReaction } = await import('@/foundry/handlers/reactions')

function args(overrides: Partial<ToggleReactionArgs> = {}): ToggleReactionArgs {
  return {
    action: TM.TOGGLE_REACTION,
    uuid: 'req-1',
    userId: 'u1',
    messageId: 'msg-1',
    emoji: THUMB,
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  message = makeMessage()
  // makeAck reads the bare `game` global for the answering client's id, so stand
  // up the minimum it needs (mirrors voiceMemo.spec.ts).
  ;(globalThis as Record<string, unknown>).game = { user: { _id: 'gm-1' } }
})

describe('foundryToggleReaction', () => {
  it('adds the requesting user’s reaction and acks with the stored list', async () => {
    const ack = await foundryToggleReaction(args())

    expect(setFlagMock).toHaveBeenCalledWith('tablemate', 'reactions', [
      { emoji: THUMB, userId: 'u1' }
    ])
    expect(ack.reactions).toEqual([{ emoji: THUMB, userId: 'u1' }])
    expect(ack.uuid).toBe('req-1')
  })

  it('removes the reaction on a second toggle', async () => {
    await foundryToggleReaction(args())
    const ack = await foundryToggleReaction(args())
    expect(ack.reactions).toEqual([])
  })

  it('leaves other users’ reactions alone', async () => {
    message = makeMessage([
      { emoji: THUMB, userId: 'gm-1' },
      { emoji: HEART, userId: 'u2' }
    ])

    const ack = await foundryToggleReaction(args({ emoji: THUMB, userId: 'u1' }))
    expect(ack.reactions).toEqual([
      { emoji: THUMB, userId: 'gm-1' },
      { emoji: HEART, userId: 'u2' },
      { emoji: THUMB, userId: 'u1' }
    ])

    // ...and removing only takes out the requester's own entry.
    const removed = await foundryToggleReaction(args({ emoji: THUMB, userId: 'u1' }))
    expect(removed.reactions).toEqual([
      { emoji: THUMB, userId: 'gm-1' },
      { emoji: HEART, userId: 'u2' }
    ])
  })

  it('reacts as args.userId, ignoring any id the payload cannot influence', async () => {
    const ack = await foundryToggleReaction(args({ userId: 'u9' }))
    expect(ack.reactions).toEqual([{ emoji: THUMB, userId: 'u9' }])
  })

  it('rejects an emoji outside the palette without writing', async () => {
    await expect(foundryToggleReaction(args({ emoji: '🦑' }))).rejects.toThrow(
      /Unsupported reaction emoji/
    )
    expect(setFlagMock).not.toHaveBeenCalled()
  })

  it('rejects a missing message', async () => {
    message = undefined
    await expect(foundryToggleReaction(args())).rejects.toThrow(/not found/)
  })

  it('discards a malformed stored flag rather than propagating it', async () => {
    // A hand-edited document (or a stale build using another shape) must not be
    // able to put junk back on the wire.
    message = makeMessage([{ emoji: '🦑', userId: 'u2' }, 'garbage'])
    const ack = await foundryToggleReaction(args())
    expect(ack.reactions).toEqual([{ emoji: THUMB, userId: 'u1' }])
  })
})
