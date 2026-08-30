import { describe, it, expect } from 'vitest'
import { actionCost } from '@/utils/actionCost'
import { pf2eGlyphHtml } from '@/utils/pf2eEnrich'

describe('actionCost', () => {
  it('maps action counts to font characters', () => {
    expect(actionCost('1')).toEqual({ kind: 'glyph', glyph: '1' })
    expect(actionCost(2)).toEqual({ kind: 'glyph', glyph: '2' })
    expect(actionCost('3')).toEqual({ kind: 'glyph', glyph: '3' })
  })

  it('maps free actions and reactions, however they are spelled', () => {
    expect(actionCost('free')).toEqual({ kind: 'glyph', glyph: 'f' })
    expect(actionCost('Free Action')).toEqual({ kind: 'glyph', glyph: 'f' })
    expect(actionCost('free-action')).toEqual({ kind: 'glyph', glyph: 'f' })
    expect(actionCost(0)).toEqual({ kind: 'glyph', glyph: 'f' })
    expect(actionCost('Reaction')).toEqual({ kind: 'glyph', glyph: 'r' })
    expect(actionCost('r')).toEqual({ kind: 'glyph', glyph: 'r' })
  })

  it('maps spreads the way PF2e does', () => {
    expect(actionCost('1 to 3')).toEqual({ kind: 'glyph', glyph: '1 – 3' })
    expect(actionCost('1 or 2')).toEqual({ kind: 'glyph', glyph: '1/2' })
    expect(actionCost('2 or 3')).toEqual({ kind: 'glyph', glyph: '2/3' })
    expect(actionCost('2 rounds')).toEqual({ kind: 'glyph', glyph: '3,3' })
  })

  // The bug this split exists for: the icon font covers "1" and "t", so a
  // minute-long cast used to print an action glyph, some letters, and a
  // three-action glyph where the "t" of "minute" was.
  it('leaves prose costs as words', () => {
    expect(actionCost('1 minute')).toEqual({ kind: 'text', text: '1 minute' })
    expect(actionCost('10 minutes')).toEqual({ kind: 'text', text: '10 minutes' })
    expect(actionCost('8 hours')).toEqual({ kind: 'text', text: '8 hours' })
    expect(actionCost('1 day')).toEqual({ kind: 'text', text: '1 day' })
    expect(actionCost('1 minute (see text)')).toEqual({
      kind: 'text',
      text: '1 minute (see text)'
    })
  })

  it('reports an absent cost as empty text', () => {
    expect(actionCost(undefined)).toEqual({ kind: 'text', text: '' })
    expect(actionCost(null)).toEqual({ kind: 'text', text: '' })
    expect(actionCost('  ')).toEqual({ kind: 'text', text: '' })
  })

  // A bare 4 is a count of actions, not the font's free-action character.
  it('does not read the font’s own 4 and 5 as data', () => {
    expect(actionCost('4')).toEqual({ kind: 'text', text: '4' })
    expect(actionCost('5')).toEqual({ kind: 'text', text: '5' })
  })
})

describe('pf2eGlyphHtml', () => {
  it('wraps a mapped cost in an action-glyph span', () => {
    expect(pf2eGlyphHtml('Action 1')).toBe('<span class="action-glyph">1</span>')
    expect(pf2eGlyphHtml('Three Actions')).toBe('<span class="action-glyph">3</span>')
    expect(pf2eGlyphHtml('Reaction')).toBe('<span class="action-glyph">r</span>')
  })

  it('escapes an unmapped argument instead of setting it in the icon font', () => {
    expect(pf2eGlyphHtml('10 minutes')).toBe('10 minutes')
    expect(pf2eGlyphHtml('<b>')).toBe('&lt;b&gt;')
  })
})
