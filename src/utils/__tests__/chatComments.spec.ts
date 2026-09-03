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
  USER_COMMENT_MAX,
  trimUserComments,
  normalizeUserComments,
  upsertUserComment,
  type ChatComment,
  type UserComment
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

// ── The per-author storage budget ───────────────────────────────────────────
//
// This list is written WHOLE on every save and rides in core's world dump on
// every connect, so its size is what a tap costs the table. A count bounds that
// only for fixed-size entries — true of reactions, not of a comment, whose text
// is free up to COMMENT_MAX_LENGTH. USER_COMMENT_MAX alone let one author's list
// reach 120 KB, five times the reactions cap it was written to undercut.

function userComment(id: string, text = 'ok'): UserComment {
  return { id, messageId: 'm1', text, timestamp: Number(id.replace(/\D/g, '')) || 0 }
}

/** A list of `n` comments each carrying `chars` of text. */
function bulk(n: number, chars: number): UserComment[] {
  return Array.from({ length: n }, (_, i) => userComment(`c${i + 1}`, 'x'.repeat(chars)))
}

describe('trimUserComments', () => {
  it('leaves a list that fits both limits alone', () => {
    const list = bulk(10, 40)
    expect(trimUserComments(list)).toEqual(list)
  })

  it('drops the oldest when the character budget is exceeded', () => {
    // At full length each entry costs ~612 bytes, so the budget binds long
    // before the count does.
    const trimmed = trimUserComments(bulk(200, COMMENT_MAX_LENGTH))
    expect(trimmed.length).toBeLessThan(200)
    // Newest kept, oldest dropped.
    expect(trimmed.at(-1)?.id).toBe('c200')
    expect(trimmed[0].id).not.toBe('c1')
  })

  it('keeps more short remarks than long ones, which is the point', () => {
    const short = trimUserComments(bulk(200, 20)).length
    const long = trimUserComments(bulk(200, COMMENT_MAX_LENGTH)).length
    expect(short).toBeGreaterThan(long)
  })

  it('still honours the count cap when the entries are tiny', () => {
    expect(trimUserComments(bulk(USER_COMMENT_MAX + 50, 1))).toHaveLength(USER_COMMENT_MAX)
  })

  // The bound that motivated the budget: whatever an author has written, the
  // stored list stays in the same range as a full reaction list (~24 KB).
  it('bounds the serialized list near the reactions cap', () => {
    const bytes = (list: UserComment[]) => new TextEncoder().encode(JSON.stringify(list)).length
    expect(bytes(trimUserComments(bulk(400, COMMENT_MAX_LENGTH)))).toBeLessThan(32 * 1024)
    expect(bytes(trimUserComments(bulk(400, 60)))).toBeLessThan(32 * 1024)
  })
})

describe('the budget applies wherever the list is built', () => {
  it('trims on read, so a list written by an older build is bounded', () => {
    expect(normalizeUserComments(bulk(200, COMMENT_MAX_LENGTH)).length).toBeLessThan(200)
  })

  it('trims when a comment is added', () => {
    const full = bulk(60, COMMENT_MAX_LENGTH)
    const next = upsertUserComment(full, userComment('newest', 'short'))
    expect(next.at(-1)?.id).toBe('newest')
    expect(next.length).toBeLessThan(full.length + 1)
  })

  // An edit grows the list as surely as an add does — a one-word remark
  // rewritten into a paragraph is the same bytes.
  it('trims when a comment is edited into something much longer', () => {
    const full = bulk(45, COMMENT_MAX_LENGTH)
    const grown = upsertUserComment(full, {
      ...full[0],
      text: 'y'.repeat(COMMENT_MAX_LENGTH)
    })
    expect(grown.length).toBeLessThanOrEqual(full.length)
  })

  it('leaves a removal alone — it only ever shrinks the list', () => {
    const list = bulk(3, 10)
    expect(upsertUserComment(list, { ...list[1], text: '' }).map((c) => c.id)).toEqual(['c1', 'c3'])
  })
})
