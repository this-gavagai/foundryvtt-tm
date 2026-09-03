// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

// A message has TWO notions of "mine", and conflating them is how the edit and
// delete affordances came to be offered on messages the server would refuse.
//
//   • isOwnMessage — the DISPLAY notion. Widened across the tablemate origin
//     flag and the belongsTo pair, because a roll the app made is the player's
//     roll however it reached the log. Drives alignment, grouping and unread.
//
//   • isAuthor — Foundry's `author`, matched exactly. The only id a write's
//     permissions are decided against.
//
// They differ over precisely one set: the cards the GM's client posts on a
// player's behalf. PF2e's pipelines run there, so the GM is the author, and the
// module stamps the requesting player's id into flags.tablemate.originUserId so
// the log still reads correctly. A player editing or deleting one of those is
// refused by Foundry — which is why the affordance has to ask isAuthor.

vi.mock('@/composables/useHapticFeedback', () => ({ triggerLightHapticFeedback: vi.fn() }))

const { useChatMessages } = await import('@/composables/useChatMessages')
const { useChatVisibility } = await import('@/composables/useChatVisibility')
const { useWorldStore } = await import('@/stores/world')
const { useUserStore } = await import('@/stores/user')

type SeededMessage = {
  _id: string
  author?: string | { _id: string }
  content?: string
  timestamp?: number
  flags?: Record<string, unknown>
}

function seedWorld(messages: SeededMessage[]) {
  useWorldStore().world = {
    userId: 'seelah-user',
    messages,
    users: [
      { _id: 'seelah-user', name: 'Seelah', role: 1, flags: {} },
      { _id: 'gm-user', name: 'GM', role: 4, flags: {} },
      { _id: 'human-user', name: 'The Human', role: 1, flags: {} }
    ],
    settings: []
  } as never
}

/** The rendered view for one seeded message id. */
function viewFor(messageId: string) {
  const { renderedMessages } = useChatMessages(ref('seelah-actor'))
  return renderedMessages.value.find((v) => v.message._id === messageId)
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.stubGlobal('__APP_VERSION__', '0.0.0-test')
  setActivePinia(createPinia())
  useUserStore().setUserId('seelah-user')
})

describe('a card the GM’s client posted on this player’s behalf', () => {
  // This is every roll, spell card and item card the app asks for.
  const rollCard: SeededMessage = {
    _id: 'roll-1',
    author: 'gm-user',
    content: '<div>Athletics</div>',
    timestamp: 1,
    flags: { tablemate: { originUserId: 'seelah-user' } }
  }

  it('reads as the player’s for display', () => {
    seedWorld([rollCard])
    expect(viewFor('roll-1')?.isOwnMessage).toBe(true)
  })

  it('is NOT authored by the player, so edit and delete stay off it', () => {
    seedWorld([rollCard])
    // The affordance in ChatMessageRow is gated on this. Before, it asked
    // isOwnMessage and offered Delete on a write Foundry refuses — a socket
    // round trip spent to learn what the author field already said.
    expect(viewFor('roll-1')?.isAuthor).toBe(false)
  })
})

describe('a message the player posted directly', () => {
  const ownPost: SeededMessage = {
    _id: 'said-1',
    author: 'seelah-user',
    content: 'I check the door',
    timestamp: 1,
    flags: { tablemate: { originUserId: 'seelah-user' } }
  }

  it('is both theirs and authored by them', () => {
    seedWorld([ownPost])
    const view = viewFor('said-1')
    expect(view?.isOwnMessage).toBe(true)
    expect(view?.isAuthor).toBe(true)
  })

  // A voice memo and an image go through the GM, but the module creates them
  // with `author: args.userId` — so unlike a roll card, the player really is the
  // author and can still delete or re-transcribe them.
  it('covers media the module posted under the player’s name', () => {
    seedWorld([{ ...ownPost, _id: 'memo-1', author: { _id: 'seelah-user' } }])
    expect(viewFor('memo-1')?.isAuthor).toBe(true)
  })
})

describe('somebody else’s message', () => {
  it('is neither theirs nor authored by them', () => {
    seedWorld([{ _id: 'gm-said', author: 'gm-user', content: 'The door is locked', timestamp: 1 }])
    const view = viewFor('gm-said')
    expect(view?.isOwnMessage).toBe(false)
    expect(view?.isAuthor).toBe(false)
  })
})

// A sheet-only user attached to a human login through flags.tablemate.belongsTo
// is treated as the same person for READING — whispers, attribution, unread.
// Authorship cannot widen the same way: the linked identity is a different
// Foundry user, and the server refuses a write to another user's message however
// related the two people are. Same rule as a reaction's `mine`.
describe('a message authored by this user’s belongsTo identity', () => {
  beforeEach(() => {
    seedWorld([
      { _id: 'human-said', author: 'human-user', content: 'out of character', timestamp: 1 }
    ])
    const world = useWorldStore()
    const users = (world.world as unknown as { users: { _id: string; flags: object }[] }).users
    users[0].flags = { tablemate: { belongsTo: 'human-user' } }
    world.bumpUsersRevision()
  })

  it('reads as this person’s for display', () => {
    expect(viewFor('human-said')?.isOwnMessage).toBe(true)
  })

  it('is not this client’s to edit or delete', () => {
    expect(viewFor('human-said')?.isAuthor).toBe(false)
  })
})

// The distinction lives in useChatVisibility, where the unread badge reads it
// too. Pinned directly so a future caller sees which question it is asking.
describe('useChatVisibility', () => {
  it('separates the display notion from the permission one', () => {
    seedWorld([])
    const { messageIsFromCurrentUser, messageAuthoredByCurrentUser } = useChatVisibility()
    const proxied = {
      _id: 'roll-1',
      author: 'gm-user',
      flags: { tablemate: { originUserId: 'seelah-user' } }
    } as never

    expect(messageIsFromCurrentUser(proxied)).toBe(true)
    expect(messageAuthoredByCurrentUser(proxied)).toBe(false)
  })

  it('answers false for both when no user is signed in', () => {
    seedWorld([])
    useUserStore().setUserId(null as never)
    const { messageIsFromCurrentUser, messageAuthoredByCurrentUser } = useChatVisibility()
    const mine = { _id: 'x', author: 'seelah-user' } as never

    expect(messageIsFromCurrentUser(mine)).toBe(false)
    expect(messageAuthoredByCurrentUser(mine)).toBe(false)
  })
})
