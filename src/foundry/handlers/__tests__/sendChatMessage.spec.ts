import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TM } from '@/api/protocol'
import type { SendChatMessageArgs } from '@/types/api-types'
import { fakeChatLogParse, makeFakeGetWhisperRecipients } from './fakeChatCore'

// Text typed on a tablet takes the same chat commands as Foundry's own chat bar,
// because the handler now parses it with core's ChatLog.parse and resolves
// recipients with core's ChatMessage.getWhisperRecipients instead of a private
// regex and lookup of its own.
//
// These tests run the real handler against copies of those two core functions
// (fakeChatCore.ts), so what they actually pin is the handler's reading of core's
// output — above all the whisper regex's capture-group layout, which the handler
// indexes into and is the one thing it could get quietly wrong.

const users = [
  { id: 'gm-1', name: 'GM', isGM: true },
  { id: 'gm-2', name: 'Asst', isGM: true },
  { id: 'user-2', name: 'Bob', isGM: false },
  { id: 'user-3', name: 'Ana Vale', isGM: false },
  // Plays Ezren, so "Ezren" should reach them — core resolves a name against
  // users' assigned characters after their login names.
  { id: 'user-4', name: 'Dana', isGM: false }
]

const fakeActor = { id: 'seelah-id', name: 'Seelah' }
const fakeGame = {
  actors: { get: vi.fn(() => fakeActor) },
  users: Object.assign([...users], { get: (id: string) => users.find((u) => u.id === id) })
}

vi.mock('@/foundry/utils/foundry', async (importActual) => {
  const actual = await importActual<typeof import('@/foundry/utils/foundry')>()
  return { ...actual, getGame: vi.fn(() => fakeGame) }
})

const { foundrySendChatMessage } = await import('@/foundry/handlers/chat')

const createMock = vi.fn<(data: Record<string, unknown>) => Promise<object>>(async () => ({
  id: 'msg-1'
}))

type CreatedMessage = {
  author?: string
  content?: string
  whisper?: string[]
  speaker?: { actor?: string; alias?: string }
}
const created = () => createMock.mock.calls[0]?.[0] as unknown as CreatedMessage

const send = (content: string, extra: Partial<SendChatMessageArgs> = {}) =>
  foundrySendChatMessage({
    action: TM.SEND_CHAT_MESSAGE,
    uuid: 'req-1',
    userId: 'user-2',
    characterId: 'seelah-id',
    content,
    ...extra
  } as SendChatMessageArgs)

beforeEach(() => {
  vi.clearAllMocks()
  const g = globalThis as Record<string, unknown>
  g.game = { user: { _id: 'gm-1' } }
  g.ChatMessage = {
    create: createMock,
    getWhisperRecipients: makeFakeGetWhisperRecipients(users, { 'user-4': 'Ezren' })
  }
  // Where v13+ exposes ChatLog. The handler also accepts the bare global that
  // older generations expose — covered explicitly below.
  g.foundry = { applications: { sidebar: { tabs: { ChatLog: { parse: fakeChatLogParse } } } } }
})

afterEach(() => {
  const g = globalThis as Record<string, unknown>
  delete g.game
  delete g.ChatMessage
  delete g.foundry
  delete g.ChatLog
})

describe('plain messages', () => {
  it('posts as the character, with no recipients', async () => {
    await send('I attack the goblin')
    expect(created().whisper).toBeUndefined()
    expect(created().content).toBe('I attack the goblin')
    expect(created().speaker).toEqual({ actor: 'seelah-id', alias: 'Seelah' })
    expect(created().author).toBe('user-2')
  })

  it('escapes markup and keeps line breaks', async () => {
    await send('a <b>bold</b> & "quoted"\nsecond line')
    expect(created().content).toBe(
      'a &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot;<br>second line'
    )
  })

  it('acks without posting an empty message', async () => {
    const ack = await send('   ')
    expect(createMock).not.toHaveBeenCalled()
    expect(ack).toMatchObject({ action: TM.ACK, uuid: 'req-1' })
  })

  it('speaks as the player when out of character', async () => {
    await send('meta comment', { outOfCharacter: true })
    expect(created().speaker).toEqual({ alias: 'Bob' })
  })
})

describe('/w', () => {
  it('addresses a single user and strips the command from the body', async () => {
    await send('/w Bob psst')
    expect(created().whisper).toEqual(['user-2'])
    expect(created().content).toBe('psst')
  })

  it('accepts the long form', async () => {
    await send('/whisper Bob psst')
    expect(created().whisper).toEqual(['user-2'])
    expect(created().content).toBe('psst')
  })

  it('is case-insensitive in both command and name', async () => {
    await send('/W bob psst')
    expect(created().whisper).toEqual(['user-2'])
  })

  // A bracketed target is how a name with spaces is addressed. Getting the
  // recipient/body boundary wrong here silently leaks the message or eats words
  // off the front of it, which is why it is pinned.
  it('addresses a bracketed name containing spaces', async () => {
    await send('/w [Ana Vale] over here')
    expect(created().whisper).toEqual(['user-3'])
    expect(created().content).toBe('over here')
  })

  it('addresses several comma-separated names', async () => {
    await send('/w Bob,Dana both of you')
    expect(created().whisper).toEqual(['user-2', 'user-4'])
    expect(created().content).toBe('both of you')
  })

  // The capability gained by delegating to core: a name that matches a user's
  // assigned character, not just their login name.
  it("addresses a player by their character's name", async () => {
    await send('/w Ezren nice staff')
    expect(created().whisper).toEqual(['user-4'])
  })

  it('escapes the whispered body too', async () => {
    await send('/w Bob <script>x</script>')
    expect(created().content).toBe('&lt;script&gt;x&lt;/script&gt;')
  })

  it('acks without posting when the body is empty', async () => {
    await send('/w Bob')
    expect(createMock).not.toHaveBeenCalled()
  })

  // A private message whose target doesn't resolve must not become public: an
  // empty `whisper` array reads as a public message in Foundry.
  it('scopes an unresolvable whisper to its author rather than posting publicly', async () => {
    await send('/w Nobody secret')
    expect(created().whisper).toEqual(['user-2'])
    expect(created().content).toBe('secret')
  })

  it('de-duplicates a name listed twice', async () => {
    await send('/w Bob,Bob hi')
    expect(created().whisper).toEqual(['user-2'])
  })

  // BEHAVIOUR CHANGE, pinned deliberately. Core's whisper regex captures ONE
  // target token — bracketed, or a run of non-space characters it then splits on
  // commas — so combining brackets WITH commas addresses only the first name and
  // the rest falls into the body. The parser this replaced accepted the
  // combination; Foundry's own chat bar does not, and matching Foundry is the
  // point of delegating to it. Comma-separated bare names (above) remain the way
  // to address several people, and the app's own UI sends a target list directly.
  //
  // Not a leak: the message still goes privately to the first name, and the
  // stray ",[…]" left in the body is visible to the sender.
  it('addresses only the first name when brackets and commas are combined', async () => {
    await send('/w [Ana Vale],[Bob] hi')
    expect(created().whisper).toEqual(['user-3'])
    expect(created().content).toBe(',[Bob] hi')
  })
})

describe('/gm and /players', () => {
  it('/gm addresses every GM', async () => {
    await send('/gm just between us')
    expect(created().whisper).toEqual(['gm-1', 'gm-2'])
    expect(created().content).toBe('just between us')
  })

  it('/players addresses everyone who is not a GM', async () => {
    await send('/players listen up')
    expect(created().whisper).toEqual(['user-2', 'user-3', 'user-4'])
    expect(created().content).toBe('listen up')
  })

  it('/w gm is the keyword form of the same thing', async () => {
    await send('/w gm psst')
    expect(created().whisper).toEqual(['gm-1', 'gm-2'])
  })
})

describe('commands this handler does not implement', () => {
  // Core recognizes these; the handler doesn't act on them and posts the text
  // as-is, exactly as before. The point is that they are NOT mistaken for
  // whispers — a `/roll` landing in the whisper branch would post the formula to
  // one recipient instead of the table.
  it.each(['/roll 1d20+5', '/gmroll 1d20', '/ooc hello', '/emote waves', '/bogus x'])(
    'posts %s publicly, as literal text',
    async (text) => {
      await send(text)
      expect(created().whisper).toBeUndefined()
      expect(created().content).toBe(text)
    }
  )
})

describe('ChatLog resolution', () => {
  it('falls back to the bare global that pre-v13 generations expose', async () => {
    const g = globalThis as Record<string, unknown>
    delete g.foundry
    g.ChatLog = { parse: fakeChatLogParse }
    await send('/w Bob psst')
    expect(created().whisper).toEqual(['user-2'])
  })

  // If neither shape is present the message must still be posted — publicly, as
  // plain text — rather than the handler throwing and the tablet seeing a failure.
  it('posts the text unparsed when ChatLog cannot be found at all', async () => {
    const g = globalThis as Record<string, unknown>
    delete g.foundry
    await send('/w Bob psst')
    expect(created().whisper).toBeUndefined()
    expect(created().content).toBe('/w Bob psst')
  })
})
