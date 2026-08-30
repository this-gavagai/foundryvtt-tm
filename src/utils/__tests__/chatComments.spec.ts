import { describe, it, expect } from 'vitest'
import {
  COMMENT_MAX_LENGTH,
  COMMENT_MAX_COUNT,
  canModifyComment,
  normalizeComments,
  readComments,
  removeComment,
  sanitizeCommentText,
  upsertComment,
  type ChatComment
} from '@/utils/chatComments'

function comment(overrides: Partial<ChatComment> = {}): ChatComment {
  return { id: 'c1', userId: 'u1', text: 'nice hit', timestamp: 10, ...overrides }
}

describe('sanitizeCommentText', () => {
  it('trims, collapses blank-line runs, and caps the length', () => {
    expect(sanitizeCommentText('  spaced  ')).toBe('spaced')
    expect(sanitizeCommentText('a\n\n\n\nb')).toBe('a\n\nb')
    expect(sanitizeCommentText('x'.repeat(COMMENT_MAX_LENGTH + 50))).toHaveLength(
      COMMENT_MAX_LENGTH
    )
  })

  it('reads anything unusable as empty', () => {
    expect(sanitizeCommentText('   \n  ')).toBe('')
    expect(sanitizeCommentText(undefined)).toBe('')
    expect(sanitizeCommentText({ text: 'no' })).toBe('')
  })
})

describe('normalizeComments', () => {
  it('drops entries that are not usable comments', () => {
    expect(
      normalizeComments([
        comment(),
        { id: '', userId: 'u1', text: 'no id', timestamp: 1 },
        { id: 'c2', userId: '', text: 'no author', timestamp: 1 },
        { id: 'c3', userId: 'u1', text: '   ', timestamp: 1 },
        'not an object',
        null
      ])
    ).toEqual([comment()])
  })

  it('drops duplicate ids rather than rendering a comment twice', () => {
    const comments = normalizeComments([comment(), comment({ text: 'second' })])
    expect(comments).toHaveLength(1)
    expect(comments[0].text).toBe('nice hit')
  })

  it('orders oldest first and bounds the list', () => {
    const many = Array.from({ length: COMMENT_MAX_COUNT + 5 }, (_, i) =>
      comment({ id: `c${i}`, timestamp: i })
    )
    const comments = normalizeComments([...many].reverse())
    expect(comments).toHaveLength(COMMENT_MAX_COUNT)
    // The cap keeps the NEWEST comments: an overflowing message loses its oldest.
    expect(comments[0].timestamp).toBe(5)
    expect(comments.at(-1)?.timestamp).toBe(COMMENT_MAX_COUNT + 4)
  })

  it('reads a missing timestamp as 0 rather than dropping the comment', () => {
    expect(normalizeComments([{ id: 'c1', userId: 'u1', text: 'hi' }])[0].timestamp).toBe(0)
  })

  it('answers a non-array with an empty list', () => {
    expect(normalizeComments(undefined)).toEqual([])
    expect(normalizeComments({ c1: comment() })).toEqual([])
  })
})

describe('readComments', () => {
  // The three shapes the flag reaches a reader in: a Foundry document answering
  // getFlag, a nested flags object, and the dotted key a fresh broadcast carries.
  it('reads through getFlag', () => {
    expect(readComments({ getFlag: () => [comment()] })).toEqual([comment()])
  })

  it('reads a nested flags object', () => {
    expect(readComments({ flags: { tablemate: { comments: [comment()] } } })).toEqual([comment()])
  })

  it('reads a dotted broadcast key', () => {
    expect(readComments({ 'flags.tablemate.comments': [comment()] })).toEqual([comment()])
  })

  it('answers an absent flag with an empty list', () => {
    expect(readComments({})).toEqual([])
    expect(readComments(null)).toEqual([])
  })
})

describe('upsertComment', () => {
  it('appends a new comment', () => {
    expect(upsertComment([comment()], comment({ id: 'c2', text: 'and again' }))).toEqual([
      comment(),
      comment({ id: 'c2', text: 'and again' })
    ])
  })

  it('replaces in place, keeping the original timestamp', () => {
    const edited = upsertComment(
      [comment(), comment({ id: 'c2', timestamp: 20 })],
      comment({ text: 'rewritten', timestamp: 999 })
    )
    // Position and timestamp both hold: an edit must not jump the comment to the
    // bottom of the thread.
    expect(edited[0]).toEqual(comment({ text: 'rewritten', timestamp: 10 }))
    expect(edited[1].id).toBe('c2')
  })

  it('never mutates the list it was given', () => {
    const current = [comment()]
    upsertComment(current, comment({ id: 'c2' }))
    expect(current).toHaveLength(1)
  })
})

describe('removeComment', () => {
  it('removes only the named comment', () => {
    expect(removeComment([comment(), comment({ id: 'c2' })], 'c1')).toEqual([comment({ id: 'c2' })])
  })
})

describe('canModifyComment', () => {
  it('lets the author change their own comment', () => {
    expect(canModifyComment(comment(), 'u1', false)).toBe(true)
    expect(canModifyComment(comment(), new Set(['u1']), false)).toBe(true)
  })

  it('refuses someone else', () => {
    expect(canModifyComment(comment(), 'u2', false)).toBe(false)
    expect(canModifyComment(comment(), null, false)).toBe(false)
  })

  it('lets a GM change anyone’s comment', () => {
    expect(canModifyComment(comment(), 'u2', true)).toBe(true)
  })
})
