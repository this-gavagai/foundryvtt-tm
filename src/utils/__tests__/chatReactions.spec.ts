import { describe, it, expect } from 'vitest'
import {
  REACTION_EMOJI,
  groupReactions,
  isReactionEmoji,
  normalizeReactions,
  readReactions,
  toggleReaction,
  type ChatReaction
} from '@/utils/chatReactions'

const [THUMB, HEART] = REACTION_EMOJI

describe('isReactionEmoji', () => {
  it('accepts the palette and rejects everything else', () => {
    for (const emoji of REACTION_EMOJI) expect(isReactionEmoji(emoji)).toBe(true)
    expect(isReactionEmoji('🦑')).toBe(false)
    expect(isReactionEmoji('')).toBe(false)
    expect(isReactionEmoji(undefined)).toBe(false)
    // A hostile payload shouldn't be able to smuggle markup into the flag.
    expect(isReactionEmoji('<img src=x onerror=alert(1)>')).toBe(false)
  })
})

describe('normalizeReactions', () => {
  it('drops entries that are not a valid (palette emoji, user id) pair', () => {
    expect(
      normalizeReactions([
        { emoji: THUMB, userId: 'u1' },
        { emoji: '🦑', userId: 'u1' },
        { emoji: THUMB, userId: '' },
        { emoji: THUMB },
        'nonsense',
        null,
        { userId: 'u2' }
      ])
    ).toEqual([{ emoji: THUMB, userId: 'u1' }])
  })

  it('collapses a duplicated (emoji, user) pair so it cannot double a count', () => {
    expect(
      normalizeReactions([
        { emoji: THUMB, userId: 'u1' },
        { emoji: THUMB, userId: 'u1' }
      ])
    ).toEqual([{ emoji: THUMB, userId: 'u1' }])
  })

  it('treats a non-array (including the map shape) as empty', () => {
    expect(normalizeReactions(undefined)).toEqual([])
    expect(normalizeReactions({ [THUMB]: ['u1'] })).toEqual([])
  })
})

describe('readReactions', () => {
  const stored = [{ emoji: THUMB, userId: 'u1' }]

  it('reads through getFlag, the nested flag, and the dotted key', () => {
    expect(readReactions({ getFlag: () => stored })).toEqual(stored)
    expect(readReactions({ flags: { tablemate: { reactions: stored } } })).toEqual(stored)
    expect(readReactions({ 'flags.tablemate.reactions': stored })).toEqual(stored)
  })

  it('falls back past a getFlag that answers with nothing', () => {
    expect(
      readReactions({ getFlag: () => undefined, flags: { tablemate: { reactions: stored } } })
    ).toEqual(stored)
  })

  it('is empty for a message with no reactions', () => {
    expect(readReactions(undefined)).toEqual([])
    expect(readReactions({})).toEqual([])
    expect(readReactions({ flags: { tablemate: {} } })).toEqual([])
  })
})

describe('toggleReaction', () => {
  it('adds the reaction when absent', () => {
    expect(toggleReaction([], THUMB, 'u1')).toEqual([{ emoji: THUMB, userId: 'u1' }])
  })

  it('removes it when the same user already reacted with it', () => {
    const current: ChatReaction[] = [
      { emoji: THUMB, userId: 'u1' },
      { emoji: THUMB, userId: 'u2' }
    ]
    expect(toggleReaction(current, THUMB, 'u1')).toEqual([{ emoji: THUMB, userId: 'u2' }])
  })

  it('touches only the given (emoji, user) pair', () => {
    const current: ChatReaction[] = [
      { emoji: THUMB, userId: 'u1' },
      { emoji: HEART, userId: 'u1' },
      { emoji: HEART, userId: 'u2' }
    ]
    expect(toggleReaction(current, HEART, 'u1')).toEqual([
      { emoji: THUMB, userId: 'u1' },
      { emoji: HEART, userId: 'u2' }
    ])
  })

  it('does not mutate the input', () => {
    const current: ChatReaction[] = [{ emoji: THUMB, userId: 'u1' }]
    toggleReaction(current, HEART, 'u1')
    expect(current).toEqual([{ emoji: THUMB, userId: 'u1' }])
  })
})

describe('groupReactions', () => {
  const reactions: ChatReaction[] = [
    { emoji: HEART, userId: 'u2' },
    { emoji: THUMB, userId: 'u1' },
    { emoji: THUMB, userId: 'u2' }
  ]

  it('counts per emoji and resolves reactor names', () => {
    const names: Record<string, string> = { u1: 'Peter', u2: 'Otro' }
    expect(groupReactions(reactions, { selfUserId: 'u1', nameFor: (id) => names[id] })).toEqual([
      { emoji: THUMB, count: 2, mine: true, names: ['Peter', 'Otro'] },
      { emoji: HEART, count: 1, mine: false, names: ['Otro'] }
    ])
  })

  it('orders chips by the palette, not by count or insertion', () => {
    // HEART was inserted first and THUMB has the higher count; palette order wins
    // so a chip never moves under the finger between taps.
    const groups = groupReactions(reactions)
    expect(groups.map((g) => g.emoji)).toEqual([THUMB, HEART])
  })

  it('falls back to the raw id when a reactor is not a known user', () => {
    expect(groupReactions([{ emoji: THUMB, userId: 'ghost' }])[0].names).toEqual(['ghost'])
  })

  it('matches the self id exactly rather than through a linked user', () => {
    // u2's reaction must not read as mine just because u1 is linked to u2 — the
    // toggle writes under u1, so a filled chip would then ADD rather than remove.
    const groups = groupReactions([{ emoji: THUMB, userId: 'u2' }], { selfUserId: 'u1' })
    expect(groups[0].mine).toBe(false)
  })

  it('omits emoji nobody reacted with, and is empty for none', () => {
    expect(groupReactions([]).length).toBe(0)
    expect(groupReactions([{ emoji: THUMB, userId: 'u1' }]).length).toBe(1)
  })
})
