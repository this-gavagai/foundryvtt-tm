// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

// An out-of-character post has no character behind it, so the gutter that shows
// a token for every other message had nothing to draw and sat empty — a run of
// OOC chatter read as anonymous, with only the header name to tell two players
// apart. It now draws the HUMAN: the avatar they set in Foundry, or a badge with
// their initials on their own user color.
//
// The two things worth pinning are which messages count as out of character
// (the app and Foundry's chat bar say it differently), and that the picture
// resolves to the same person the name beside it names.

vi.mock('@/composables/useHapticFeedback', () => ({ triggerLightHapticFeedback: vi.fn() }))

const { useChatMessages } = await import('@/composables/useChatMessages')
const { useWorldStore } = await import('@/stores/world')
const { useUserStore } = await import('@/stores/user')

type SeededUser = {
  _id: string
  name: string
  role?: number
  avatar?: string | null
  color?: string | null
  flags?: Record<string, unknown>
}

const SEELAH: SeededUser = {
  _id: 'seelah-user',
  name: 'Seelah',
  role: 1,
  avatar: 'worlds/test/players/seelah.webp',
  color: '#3366cc'
}
const PLAIN: SeededUser = { _id: 'plain-user', name: 'Plain Player', role: 1, color: '#ffdd00' }

function seedWorld(messages: unknown[], users: SeededUser[] = [SEELAH, PLAIN]) {
  useWorldStore().world = {
    userId: 'seelah-user',
    messages,
    users,
    // One actor with token art, for the in-character comparison.
    actors: [
      {
        _id: 'seelah-actor',
        img: 'actors/seelah-portrait.webp',
        prototypeToken: { texture: { src: 'tokens/seelah.webp', scaleX: 1, scaleY: 1 } }
      }
    ],
    scenes: [],
    settings: []
  } as never
}

function viewFor(messageId: string) {
  const { renderedMessages } = useChatMessages(ref('seelah-actor'))
  return renderedMessages.value.find((v) => v.message._id === messageId)
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  setActivePinia(createPinia())
  useUserStore().setUserId('seelah-user')
})

describe('what counts as out of character', () => {
  it('an app-sent OOC post: the player’s name as a bare alias, no style', () => {
    // What foundry/handlers/chat.ts writes for `outOfCharacter` — and the common
    // case here, since this is how every tablet posts. It carries no `style`, so
    // a style-only test would miss it entirely.
    seedWorld([{ _id: 'ooc-1', author: 'seelah-user', speaker: { alias: 'Seelah' }, timestamp: 1 }])
    expect(viewFor('ooc-1')?.isOutOfCharacter).toBe(true)
  })

  it('a Foundry chat-bar OOC post: style OOC and no speaker at all', () => {
    seedWorld([{ _id: 'ooc-2', author: 'seelah-user', style: 1, timestamp: 1 }])
    expect(viewFor('ooc-2')?.isOutOfCharacter).toBe(true)
  })

  it('a message spoken by an actor is NOT out of character', () => {
    seedWorld([
      {
        _id: 'ic-1',
        author: 'seelah-user',
        speaker: { actor: 'seelah-actor', alias: 'Seelah the Paladin' },
        timestamp: 1
      }
    ])
    const view = viewFor('ic-1')
    expect(view?.isOutOfCharacter).toBe(false)
    // Still the token art, unchanged: this is the path every roll card takes.
    expect(view?.portrait).toBe('tokens/seelah.webp')
    expect(view?.authorBadge).toBeUndefined()
  })

  it('style OOC wins over an actor the message still names', () => {
    // Core nulls the speaker actor for an OOC message when it renders one, so
    // the human is the honest attribution even with an actor left on the record.
    seedWorld([
      { _id: 'ooc-3', author: 'seelah-user', style: 1, speaker: { actor: 'seelah-actor' } }
    ])
    const view = viewFor('ooc-3')
    expect(view?.isOutOfCharacter).toBe(true)
    expect(view?.portrait).toBe(SEELAH.avatar)
  })
})

describe('the picture it draws', () => {
  it('uses the author’s Foundry avatar when they have one', () => {
    seedWorld([{ _id: 'ooc-1', author: 'seelah-user', speaker: { alias: 'Seelah' } }])
    const view = viewFor('ooc-1')
    expect(view?.hasPortrait).toBe(true)
    expect(view?.portrait).toBe('worlds/test/players/seelah.webp')
    // No token scale or ring: those describe a token, not a person's picture.
    expect(view?.portraitScale).toEqual({ '--sx': 1, '--sy': 1 })
    expect(view?.portraitRing).toBeUndefined()
    // The color still rides along, to mark the picture as a player's.
    expect(view?.authorBadge?.background).toBe('#3366cc')
  })

  it('falls back to initials on the user’s color when they have no avatar', () => {
    seedWorld([{ _id: 'ooc-1', author: 'plain-user', speaker: { alias: 'Plain Player' } }])
    const view = viewFor('ooc-1')
    expect(view?.portrait).toBeUndefined()
    expect(view?.hasPortrait).toBe(true)
    expect(view?.authorBadge).toEqual({
      background: '#ffdd00',
      // Black, because yellow is the case a fixed white label gets wrong.
      foreground: '#000000',
      initials: 'PP'
    })
  })

  it('treats Foundry’s mystery-man default as no avatar', () => {
    // A world can hold CONST.DEFAULT_TOKEN literally; Foundry's own players list
    // reads that value as "nothing chosen" too. The player's color identifies
    // them, a shared silhouette doesn't.
    seedWorld(
      [{ _id: 'ooc-1', author: 'mystery-user', speaker: { alias: 'Someone' } }],
      [
        {
          _id: 'mystery-user',
          name: 'Someone',
          avatar: 'icons/svg/mystery-man.svg',
          color: '#3366cc'
        }
      ]
    )
    const view = viewFor('ooc-1')
    expect(view?.portrait).toBeUndefined()
    expect(view?.authorBadge?.initials).toBe('S')
  })

  it('does NOT borrow the assigned character’s art', () => {
    // A Foundry client's prepared User#avatar falls back to character.img; that
    // substitution never reaches the wire, and it would be exactly wrong here —
    // the message says the player is speaking as themselves.
    seedWorld([{ _id: 'ooc-1', author: 'plain-user', speaker: { alias: 'Plain Player' } }])
    expect(viewFor('ooc-1')?.portrait).toBeUndefined()
  })

  it('reserves no box for a message that names no user', () => {
    // Nothing to draw and nobody to draw it for, so the gutter stays as it was.
    seedWorld([{ _id: 'orphan-1', content: 'The world time advanced' }])
    const view = viewFor('orphan-1')
    expect(view?.isOutOfCharacter).toBe(true)
    expect(view?.hasPortrait).toBe(false)
  })
})

describe('whose picture it is', () => {
  it('follows the tablemate origin flag, like the name does', () => {
    // A card the GM's client posted for a player: the header reads the player,
    // so the portrait has to as well.
    seedWorld([
      {
        _id: 'ooc-1',
        author: 'gm-user',
        speaker: { alias: 'Seelah' },
        flags: { tablemate: { originUserId: 'seelah-user' } }
      }
    ])
    const view = viewFor('ooc-1')
    expect(view?.authorName).toBe('Seelah')
    expect(view?.portrait).toBe(SEELAH.avatar)
  })

  it('resolves a sheet-only login to the human it belongs to', () => {
    // Same belongsTo hop every other piece of chat attribution takes: the sheet
    // user has no avatar or color of its own, the human behind it does.
    seedWorld(
      [{ _id: 'ooc-1', author: 'sheet-user', speaker: { alias: 'The Human' } }],
      [
        {
          _id: 'sheet-user',
          name: 'Peter’s Sheet',
          flags: { tablemate: { belongsTo: 'human-user' } }
        },
        { _id: 'human-user', name: 'The Human', avatar: 'players/peter.webp', color: '#3366cc' }
      ]
    )
    const view = viewFor('ooc-1')
    expect(view?.portrait).toBe('players/peter.webp')
    expect(view?.authorBadge?.background).toBe('#3366cc')
  })
})
