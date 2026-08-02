import { describe, it, expect } from 'vitest'
import {
  buildChatMessageCreateData,
  buildSpeaker,
  formatChatContent,
  outOfCharacterAlias,
  withTranscriptContent,
  type ChatUserLike
} from '@/utils/chatMessage'

const users: ChatUserLike[] = [
  { _id: 'human', name: 'Peter', role: 4 },
  { _id: 'sheet', name: "Peter's Sheet", role: 1, flags: { tablemate: { belongsTo: 'human' } } },
  { _id: 'orphan', name: 'Nobody', role: 1, flags: { tablemate: { belongsTo: 'missing' } } }
]

describe('formatChatContent', () => {
  it('escapes HTML and converts newlines to <br>, mirroring the Foundry handler', () => {
    expect(formatChatContent('  <b>hi</b>\nthere  ')).toBe('&lt;b&gt;hi&lt;/b&gt;<br>there')
  })

  it('escapes quotes and ampersands', () => {
    expect(formatChatContent(`a & "b" 'c'`)).toBe('a &amp; &quot;b&quot; &#39;c&#39;')
  })
})

describe('outOfCharacterAlias', () => {
  it('uses the owning human name when the sending user Belongs To one', () => {
    expect(outOfCharacterAlias(users, 'sheet')).toBe('Peter')
  })

  it("falls back to the user's own name when there is no owner", () => {
    expect(outOfCharacterAlias(users, 'human')).toBe('Peter')
  })

  it("falls back to the user's own name when the owner id resolves to nobody", () => {
    expect(outOfCharacterAlias(users, 'orphan')).toBe('Nobody')
  })

  it('is undefined for an unknown user', () => {
    expect(outOfCharacterAlias(users, 'ghost')).toBeUndefined()
  })
})

describe('buildSpeaker', () => {
  it('binds actor + alias + scene + token for an in-character message', () => {
    expect(
      buildSpeaker({
        outOfCharacter: false,
        actorId: 'actor1',
        actorName: 'Valeros',
        sceneId: 'scene1',
        tokenId: 'token1'
      })
    ).toEqual({ actor: 'actor1', alias: 'Valeros', scene: 'scene1', token: 'token1' })
  })

  it('omits scene/token/alias that are unavailable', () => {
    expect(buildSpeaker({ outOfCharacter: false, actorId: 'actor1' })).toEqual({ actor: 'actor1' })
  })

  it('carries only the alias for an out-of-character message', () => {
    expect(
      buildSpeaker({ outOfCharacter: true, actorId: 'actor1', actorName: 'Valeros', oocAlias: 'Peter' })
    ).toEqual({ alias: 'Peter' })
  })

  it('is empty for an out-of-character message with no resolvable alias', () => {
    expect(buildSpeaker({ outOfCharacter: true, actorId: 'actor1' })).toEqual({})
  })
})

describe('buildChatMessageCreateData', () => {
  const speaker = { actor: 'actor1', alias: 'Valeros' }

  it('stamps author + origin flag and omits whisper for a public message', () => {
    const data = buildChatMessageCreateData({ userId: 'sheet', speaker, content: 'hello' })
    expect(data).toEqual({
      author: 'sheet',
      speaker,
      content: 'hello',
      flags: { tablemate: { originUserId: 'sheet' } }
    })
    expect('whisper' in data).toBe(false)
  })

  it('includes whisper recipients when present', () => {
    const data = buildChatMessageCreateData({
      userId: 'sheet',
      speaker,
      content: 'psst',
      whisperIds: ['human', 'gm2']
    })
    expect(data.whisper).toEqual(['human', 'gm2'])
  })

  it('omits an empty whisper array so the message stays public', () => {
    const data = buildChatMessageCreateData({
      userId: 'sheet',
      speaker,
      content: 'hi',
      whisperIds: []
    })
    expect('whisper' in data).toBe(false)
  })
})

// The memo's content is the caption + the <audio> Foundry's own chat log plays
// from; the transcript rides in a wrapper the app strips and re-renders itself.
// Rewriting that wrapper in place is what lets a posted memo's transcript be
// corrected without disturbing the recording.
const PLAYER = '<audio controls preload="metadata" src="audio/memo.m4a"></audio>'

describe('withTranscriptContent', () => {
  it('appends the transcript to a memo that has none', () => {
    expect(withTranscriptContent(PLAYER, 'the goblin attacks')).toBe(
      `${PLAYER}<div data-tablemate-transcript><em>the goblin attacks</em></div>`
    )
  })

  it('replaces an existing transcript, keeping the caption and the player', () => {
    const withCaption = `Listen up<br>${PLAYER}`
    const first = withTranscriptContent(withCaption, 'the goblin attacks')
    const corrected = withTranscriptContent(first, 'the hobgoblin attacks')

    expect(corrected).toBe(
      `${withCaption}<div data-tablemate-transcript><em>the hobgoblin attacks</em></div>`
    )
    // Exactly one wrapper, however many times it has been edited.
    expect(corrected.match(/data-tablemate-transcript/g)).toHaveLength(1)
  })

  it('drops the wrapper entirely for an empty transcript', () => {
    const withText = withTranscriptContent(PLAYER, 'the goblin attacks')
    expect(withTranscriptContent(withText, '   ')).toBe(PLAYER)
  })

  it('escapes the transcript so it cannot inject markup', () => {
    const content = withTranscriptContent(PLAYER, '<img src=x onerror=alert(1)> & "quoted"')
    expect(content).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(content).not.toContain('<img')
  })
})
