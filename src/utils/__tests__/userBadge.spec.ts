import { describe, it, expect } from 'vitest'
import { userBadge } from '@/utils/userBadge'

// The stand-in for a player who has set no avatar. Its whole job is to be
// recognizable, so the two things it renders — initials and the user's color —
// both have to survive whatever the world actually stored, which for a
// hand-editable required field is very nearly anything.

describe('initials', () => {
  it('takes one letter from a single name', () => {
    expect(userBadge('Peter', '#336699').initials).toBe('P')
  })

  it('takes the first and last word, so a middle name is skipped', () => {
    expect(userBadge('Ada Q. Lovelace', '#336699').initials).toBe('AL')
  })

  it('uppercases what it finds', () => {
    expect(userBadge('seelah', '#336699').initials).toBe('S')
  })

  it('keeps a whole astral-plane character rather than half a surrogate pair', () => {
    // Slicing a string by index would cut the pair and render a replacement
    // glyph. Array.from iterates code points.
    expect(userBadge('𝒢oblin King', '#336699').initials).toBe('𝒢K')
  })

  it('falls back to a mark rather than an empty badge', () => {
    expect(userBadge('   ', '#336699').initials).toBe('?')
    expect(userBadge(undefined, '#336699').initials).toBe('?')
  })
})

describe('color', () => {
  it('takes a css hex string as-is', () => {
    expect(userBadge('P', '#4488cc').background).toBe('#4488cc')
  })

  it('expands the shorthand a hand-edited world can hold', () => {
    expect(userBadge('P', '#48c').background).toBe('#4488cc')
  })

  it('accepts the numeric form a prepared Foundry Color has', () => {
    // `Color` is a Number subclass, and this app sees both shapes depending on
    // where the user document came from.
    expect(userBadge('P', 0x4488cc).background).toBe('#4488cc')
  })

  it('falls back to a neutral for a color it cannot read', () => {
    // Still a badge, still identified by its initials — not a broken swatch.
    for (const value of [undefined, null, '', 'rebeccapurple', '#12345', NaN]) {
      expect(userBadge('P', value).background).toBe('#6b7280')
    }
  })
})

describe('legibility', () => {
  // A fixed text color is wrong for half of Foundry's random user colors, and
  // the naive tests (average the channels, compare to #808080) pick white on
  // mid yellows and cyans — the colors where black is most clearly better.
  it('puts black on light and mid-bright grounds', () => {
    expect(userBadge('P', '#ffffff').foreground).toBe('#000000')
    expect(userBadge('P', '#ffff00').foreground).toBe('#000000')
    expect(userBadge('P', '#00ffff').foreground).toBe('#000000')
    // Foundry's own default player color.
    expect(userBadge('P', '#cccccc').foreground).toBe('#000000')
  })

  it('puts white on dark grounds', () => {
    expect(userBadge('P', '#000000').foreground).toBe('#ffffff')
    expect(userBadge('P', '#0000ff').foreground).toBe('#ffffff')
    expect(userBadge('P', '#800000').foreground).toBe('#ffffff')
  })

  it('reads the neutral fallback as a dark ground', () => {
    expect(userBadge('P', undefined).foreground).toBe('#ffffff')
  })
})
