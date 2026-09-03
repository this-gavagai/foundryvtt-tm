import { describe, it, expect } from 'vitest'
import {
  USER_REACTION_MAX,
  indexUserReactions,
  normalizeUserReactions,
  readUserReactions,
  toggleUserReaction
} from '@/utils/chatReactions'
import {
  USER_COMMENT_MAX,
  indexUserComments,
  normalizeUserComments,
  readUserComments,
  upsertUserComment
} from '@/utils/chatComments'

// Reactions and comments are stored on their AUTHOR's user document rather than
// on the message, which is what lets the app write them directly instead of
// asking a GM to (see the header notes in both modules). These cover the storage
// contract that move rests on: what a stored list may contain, how a toggle or
// an edit rewrites it, and how the two collapse back into the per-message view
// every consumer already reads.

const user = (id: string, flags: unknown) => ({ _id: id, flags: flags as Record<string, unknown> })
const withReactions = (id: string, reactions: unknown) => user(id, { tablemate: { reactions } })
const withComments = (id: string, comments: unknown) => user(id, { tablemate: { comments } })

describe('stored reactions', () => {
  it('reads a list off the flag', () => {
    expect(readUserReactions(withReactions('me', [{ messageId: 'm1', emoji: '👍' }]))).toEqual([
      { messageId: 'm1', emoji: '👍' }
    ])
  })

  it('reads through getFlag when handed a live document', () => {
    expect(
      readUserReactions({
        _id: 'me',
        getFlag: (scope, key) =>
          scope === 'tablemate' && key === 'reactions'
            ? [{ messageId: 'm1', emoji: '🎲' }]
            : undefined
      })
    ).toEqual([{ messageId: 'm1', emoji: '🎲' }])
  })

  // The flag is world-READABLE data that a stale build or a hand-edited world
  // could have shaped differently, so the palette is enforced on the way out as
  // well as on the way in.
  it('drops anything it does not recognize', () => {
    expect(
      normalizeUserReactions([
        { messageId: 'm1', emoji: '👍' },
        { messageId: 'm1', emoji: '💀' }, // not in the palette
        { messageId: '', emoji: '👍' },
        { emoji: '👍' },
        'nonsense',
        null
      ])
    ).toEqual([{ messageId: 'm1', emoji: '👍' }])
  })

  it('counts one reaction per message and emoji', () => {
    expect(
      normalizeUserReactions([
        { messageId: 'm1', emoji: '👍' },
        { messageId: 'm1', emoji: '👍' }
      ])
    ).toHaveLength(1)
  })

  it('toggles on and back off', () => {
    const on = toggleUserReaction([], 'm1', '👍')
    expect(on).toEqual([{ messageId: 'm1', emoji: '👍' }])
    expect(toggleUserReaction(on, 'm1', '👍')).toEqual([])
  })

  it('leaves other messages and other emoji alone', () => {
    const current = [
      { messageId: 'm0', emoji: '🎲' },
      { messageId: 'm1', emoji: '❤️' }
    ]
    expect(toggleUserReaction(current, 'm1', '👍')).toEqual([
      ...current,
      { messageId: 'm1', emoji: '👍' }
    ])
    expect(toggleUserReaction(current, 'm1', '❤️')).toEqual([{ messageId: 'm0', emoji: '🎲' }])
  })

  // This list rides in core's world dump on every connect, so it is capped
  // rather than left to grow for the life of the world. Oldest goes first: a
  // reaction on a message hundreds of sessions ago is not worth a byte.
  it('caps the history, dropping the oldest', () => {
    const many = Array.from({ length: USER_REACTION_MAX + 10 }, (_, i) => ({
      messageId: `m${i}`,
      emoji: '👍' as const
    }))
    const capped = normalizeUserReactions(many)
    expect(capped).toHaveLength(USER_REACTION_MAX)
    expect(capped[0].messageId).toBe('m10')
    expect(toggleUserReaction(many, 'new', '👍')).toHaveLength(USER_REACTION_MAX)
  })
})

describe('the reaction index', () => {
  it('collapses every user into one message-keyed view', () => {
    const index = indexUserReactions([
      withReactions('me', [
        { messageId: 'm1', emoji: '👍' },
        { messageId: 'm2', emoji: '🎲' }
      ]),
      withReactions('ezren', [{ messageId: 'm1', emoji: '❤️' }])
    ])

    expect(index.get('m1')).toEqual([
      { emoji: '👍', userId: 'me' },
      { emoji: '❤️', userId: 'ezren' }
    ])
    expect(index.get('m2')).toEqual([{ emoji: '🎲', userId: 'me' }])
    expect(index.get('m3')).toBeUndefined()
  })

  it('ignores a user with no id, which could not have authored anything', () => {
    expect(indexUserReactions([withReactions('', [{ messageId: 'm1', emoji: '👍' }])]).size).toBe(0)
  })

  // A world part-way through the rollover has reactions in both places. Showing
  // one set would make the other appear to vanish.
  it('unions in reactions still stored on the message', () => {
    const index = indexUserReactions(
      [withReactions('me', [{ messageId: 'm1', emoji: '👍' }])],
      [{ _id: 'm1', reactions: [{ emoji: '🎉', userId: 'valeros' }] }]
    )
    expect(index.get('m1')).toEqual([
      { emoji: '👍', userId: 'me' },
      { emoji: '🎉', userId: 'valeros' }
    ])
  })

  it('counts a reaction written both ways only once', () => {
    const index = indexUserReactions(
      [withReactions('me', [{ messageId: 'm1', emoji: '👍' }])],
      [{ _id: 'm1', reactions: [{ emoji: '👍', userId: 'me' }] }]
    )
    expect(index.get('m1')).toEqual([{ emoji: '👍', userId: 'me' }])
  })
})

describe('stored comments', () => {
  const comment = (over: Record<string, unknown> = {}) => ({
    id: 'c1',
    messageId: 'm1',
    text: 'a called shot',
    timestamp: 10,
    ...over
  })

  it('reads a list off the flag', () => {
    expect(readUserComments(withComments('me', [comment()]))).toEqual([comment()])
  })

  it('drops entries that are not usable comments', () => {
    expect(
      normalizeUserComments([
        comment(),
        comment({ id: '', messageId: 'm1' }),
        comment({ messageId: '' }),
        comment({ id: 'c2', text: '   ' }), // no text is spelled "removed"
        'nonsense'
      ])
    ).toEqual([comment()])
  })

  it('trims and caps the text it stores', () => {
    const [stored] = normalizeUserComments([comment({ text: '  spaced  ' })])
    expect(stored.text).toBe('spaced')
    const [long] = normalizeUserComments([comment({ text: 'x'.repeat(9999) })])
    expect(long.text.length).toBeLessThanOrEqual(500)
  })

  it('adds a comment', () => {
    expect(upsertUserComment([], comment())).toEqual([comment()])
  })

  // An edit keeps its place in the thread, which is what its timestamp means —
  // a corrected typo should not jump to the bottom.
  it('rewrites in place, keeping the original timestamp', () => {
    const edited = upsertUserComment([comment()], comment({ text: 'rewritten', timestamp: 999 }))
    expect(edited).toEqual([comment({ text: 'rewritten', timestamp: 10 })])
  })

  it('removes a comment when the text is emptied', () => {
    expect(upsertUserComment([comment()], comment({ text: '' }))).toEqual([])
  })

  it('caps the author’s history, dropping the oldest', () => {
    const many = Array.from({ length: USER_COMMENT_MAX + 5 }, (_, i) =>
      comment({ id: `c${i}`, messageId: `m${i}` })
    )
    expect(normalizeUserComments(many)).toHaveLength(USER_COMMENT_MAX)
    expect(upsertUserComment(many, comment({ id: 'new' }))).toHaveLength(USER_COMMENT_MAX)
  })
})

describe('the comment index', () => {
  // The author is reattached on read: it is the document the comment sits on,
  // not stored data, so the two cannot disagree.
  it('stamps each comment with the user whose document held it', () => {
    const index = indexUserComments([
      withComments('me', [{ id: 'c1', messageId: 'm1', text: 'mine', timestamp: 1 }])
    ])
    expect(index.get('m1')).toEqual([{ id: 'c1', userId: 'me', text: 'mine', timestamp: 1 }])
  })

  // The only thing relating entries written to two different documents.
  it('orders a thread across authors by the clock', () => {
    const index = indexUserComments([
      withComments('me', [{ id: 'c2', messageId: 'm1', text: 'second', timestamp: 20 }]),
      withComments('gm', [{ id: 'c1', messageId: 'm1', text: 'first', timestamp: 10 }])
    ])
    expect(index.get('m1')?.map((c) => c.text)).toEqual(['first', 'second'])
  })

  it('keeps each message’s thread to itself', () => {
    const index = indexUserComments([
      withComments('me', [
        { id: 'c1', messageId: 'm1', text: 'here', timestamp: 1 },
        { id: 'c2', messageId: 'm2', text: 'there', timestamp: 2 }
      ])
    ])
    expect(index.get('m1')?.map((c) => c.text)).toEqual(['here'])
    expect(index.get('m2')?.map((c) => c.text)).toEqual(['there'])
  })

  it('unions in comments still stored on the message, in clock order', () => {
    const index = indexUserComments(
      [withComments('me', [{ id: 'c2', messageId: 'm1', text: 'newer', timestamp: 20 }])],
      [{ _id: 'm1', comments: [{ id: 'c1', userId: 'gm', text: 'older', timestamp: 10 }] }]
    )
    expect(index.get('m1')?.map((c) => c.text)).toEqual(['older', 'newer'])
  })

  it('counts a comment present in both places only once', () => {
    const index = indexUserComments(
      [withComments('me', [{ id: 'c1', messageId: 'm1', text: 'once', timestamp: 1 }])],
      [{ _id: 'm1', comments: [{ id: 'c1', userId: 'me', text: 'once', timestamp: 1 }] }]
    )
    expect(index.get('m1')).toHaveLength(1)
  })
})
