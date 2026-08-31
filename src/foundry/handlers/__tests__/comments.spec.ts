import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TM, TM_ERROR_UNAUTHORIZED } from '@/api/protocol'
import type { SetCommentArgs } from '@/types/api-types'

// Two rules to hold apart. ADDING is open — anyone logged into the world may
// comment on any message, including a roll the GM's client posted for someone
// else. CHANGING an existing comment is not: only its author (or a GM) may
// rewrite or remove it, so being able to comment on a message never becomes
// editorial control over what someone else said about it.
type StoredMessage = {
  flags: { tablemate: Record<string, unknown> }
  setFlag: (scope: string, key: string, value: unknown) => Promise<unknown>
}
let message: StoredMessage | undefined

const setFlagMock = vi.fn(async (scope: string, key: string, value: unknown) => {
  // Stand in for Foundry writing the flag back, so a second call in one test
  // reads the result of the first.
  if (message) message.flags.tablemate[key] = value
  return {}
})

function makeMessage(overrides: Partial<StoredMessage> = {}): StoredMessage {
  return { flags: { tablemate: {} }, setFlag: setFlagMock, ...overrides }
}

type FakeUser = { isGM?: boolean; getFlag?: (scope: string, key: string) => unknown }
const users = new Map<string, FakeUser>()

// The world switch for the feature (featureToggles.ts), read through the bare
// `game` global below. On for every case but the one that asserts the refusal.
let commentsOn = true

const fakeGame = {
  messages: { get: vi.fn(() => message) },
  users: { get: vi.fn((id: string) => users.get(id)) }
}
vi.mock('@/foundry/utils/foundry', async (importActual) => {
  const actual = await importActual<typeof import('@/foundry/utils/foundry')>()
  return { ...actual, getGame: vi.fn(() => fakeGame) }
})

const { foundrySetComment } = await import('@/foundry/handlers/comments')

function args(overrides: Partial<SetCommentArgs> = {}): SetCommentArgs {
  return {
    action: TM.SET_COMMENT,
    uuid: 'req-1',
    userId: 'u1',
    messageId: 'msg-1',
    text: 'the blade skitters off the helm',
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  message = makeMessage()
  users.clear()
  users.set('gm-1', { isGM: true })
  users.set('u1', {})
  users.set('u2', {})
  // makeAck reads the bare `game` global for the answering client's id.
  commentsOn = true
  ;(globalThis as Record<string, unknown>).game = {
    user: { _id: 'gm-1' },
    settings: { get: () => commentsOn }
  }
})

describe('foundrySetComment', () => {
  it('refuses when the world has comments switched off', async () => {
    // Same three ways in as the reaction refusal: a stale app, a save that raced
    // the switch, or a hand-built socket message. A GM is refused too — the
    // switch turns the feature off for the world, not just for players.
    commentsOn = false

    await expect(foundrySetComment(args())).rejects.toThrow(/not enabled/i)
    await expect(foundrySetComment(args({ userId: 'gm-1' }))).rejects.toThrow(/not enabled/i)
    expect(setFlagMock).not.toHaveBeenCalled()
  })

  it('lets a GM comment on a message they did not write', async () => {
    const ack = await foundrySetComment(args({ userId: 'gm-1' }))

    expect(ack.comments).toHaveLength(1)
    expect(ack.comments[0]).toMatchObject({
      userId: 'gm-1',
      text: 'the blade skitters off the helm'
    })
    expect(ack.uuid).toBe('req-1')
    expect(setFlagMock).toHaveBeenCalledWith('tablemate', 'comments', ack.comments)
  })

  it('lets a player comment on someone else’s roll', async () => {
    // A roll made from the app is authored by the GM's client, and its roller is
    // recorded only in the origin flag — so neither the author nor the origin is
    // this player, and it still goes through.
    message = makeMessage({ flags: { tablemate: { originUserId: 'u2' } } })

    const ack = await foundrySetComment(args({ userId: 'u1' }))
    expect(ack.comments[0]).toMatchObject({ userId: 'u1' })
  })

  it('lets a player comment on their own roll', async () => {
    message = makeMessage({ flags: { tablemate: { originUserId: 'u1' } } })

    const ack = await foundrySetComment(args({ userId: 'u1' }))
    expect(ack.comments[0]).toMatchObject({ userId: 'u1' })
  })

  it('stamps the comment with the REQUESTER’s id, whatever the request claims', async () => {
    // A hostile client can't write a comment under someone else's name: the
    // author is taken from the request's user, and the id is minted here.
    const ack = await foundrySetComment(args({ userId: 'u1' }))
    expect(ack.comments[0].userId).toBe('u1')
    expect(ack.comments[0].id).toBeTruthy()
  })

  it('edits a comment in place for its author', async () => {
    const first = await foundrySetComment(args({ userId: 'u1' }))
    const commentId = first.comments[0].id

    const ack = await foundrySetComment(args({ userId: 'u1', commentId, text: 'rewritten' }))
    expect(ack.comments).toHaveLength(1)
    expect(ack.comments[0]).toMatchObject({ id: commentId, text: 'rewritten' })
  })

  it('removes a comment when the text is emptied', async () => {
    const first = await foundrySetComment(args({ userId: 'u1' }))

    const ack = await foundrySetComment(
      args({ userId: 'u1', commentId: first.comments[0].id, text: '   ' })
    )
    expect(ack.comments).toEqual([])
  })

  it('refuses editing someone else’s comment', async () => {
    // Anyone may comment on this message; nobody but its author (or a GM) may
    // rewrite the GM's remark on it.
    message = makeMessage({
      flags: {
        tablemate: {
          comments: [{ id: 'c1', userId: 'gm-1', text: 'a GM aside', timestamp: 1 }]
        }
      }
    })

    await expect(
      foundrySetComment(args({ userId: 'u1', commentId: 'c1', text: 'not yours' }))
    ).rejects.toThrow(TM_ERROR_UNAUTHORIZED)
    expect(setFlagMock).not.toHaveBeenCalled()
  })

  it('honours the belongsTo link when checking whose comment it is', async () => {
    // A sheet-only user ("Peter's Sheet") is the same person as the login user it
    // belongs to, so it may edit a comment written under either id — the same
    // widening the app uses to decide what to offer.
    users.set('u1', { getFlag: (_scope, key) => (key === 'belongsTo' ? 'human-1' : undefined) })
    message = makeMessage({
      flags: {
        tablemate: { comments: [{ id: 'c1', userId: 'human-1', text: 'mine', timestamp: 1 }] }
      }
    })

    const ack = await foundrySetComment(args({ userId: 'u1', commentId: 'c1', text: 'reworded' }))
    expect(ack.comments[0]).toMatchObject({ id: 'c1', text: 'reworded' })
  })

  it('lets a GM edit or remove anyone’s comment', async () => {
    message = makeMessage({
      flags: {
        tablemate: { comments: [{ id: 'c1', userId: 'u1', text: 'mine', timestamp: 1 }] }
      }
    })

    const ack = await foundrySetComment(args({ userId: 'gm-1', commentId: 'c1', text: '' }))
    expect(ack.comments).toEqual([])
  })

  it('refuses a comment whose id is no longer on the message', async () => {
    // Someone removed it while this edit was being typed; re-adding it silently
    // would undo their removal.
    await expect(
      foundrySetComment(args({ userId: 'u1', commentId: 'gone', text: 'back!' }))
    ).rejects.toThrow(/not found/)
  })

  it('refuses a user this world has never heard of', async () => {
    await expect(foundrySetComment(args({ userId: 'nobody' }))).rejects.toThrow(
      TM_ERROR_UNAUTHORIZED
    )
  })

  it('writes nothing for an empty new comment', async () => {
    const ack = await foundrySetComment(args({ userId: 'u1', text: '  ' }))
    expect(ack.comments).toEqual([])
    expect(setFlagMock).not.toHaveBeenCalled()
  })

  it('sanitizes the stored text rather than trusting the wire', async () => {
    const ack = await foundrySetComment(args({ userId: 'u1', text: '  padded\n\n\n\nout  ' }))
    expect(ack.comments[0].text).toBe('padded\n\nout')
  })

  it('reports a message it cannot find', async () => {
    message = undefined
    await expect(foundrySetComment(args())).rejects.toThrow(/not found/)
  })
})
