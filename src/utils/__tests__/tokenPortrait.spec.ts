import { describe, expect, it } from 'vitest'
import { tokenPortrait } from '../tokenPortrait'

describe('tokenPortrait', () => {
  it('uses the plain texture and its scale when no ring is configured', () => {
    expect(
      tokenPortrait({ texture: { src: 'art/goblin.webp', scaleX: 1.4, scaleY: 1.4 } })
    ).toEqual({ url: 'art/goblin.webp', scaleX: 1.4, scaleY: 1.4 })
  })

  it('defaults a missing scale to 1', () => {
    expect(tokenPortrait({ texture: { src: 'art/goblin.webp' } })).toEqual({
      url: 'art/goblin.webp',
      scaleX: 1,
      scaleY: 1
    })
  })

  it('prefers the ring subject art and subject scale over the base texture', () => {
    // Tokenizer's dynamic-ring output: texture.src is the full-frame avatar and
    // ring.subject.texture is the transparent-padded art drawn inside the ring.
    expect(
      tokenPortrait({
        texture: { src: 'art/Avatar.Vash.webp', scaleX: 2, scaleY: 2 },
        ring: { enabled: true, subject: { texture: 'art/Token.Vash.webp', scale: 2 } }
      })
    ).toMatchObject({ url: 'art/Token.Vash.webp', scaleX: 2, scaleY: 2 })
  })

  it('reports the ring colors and grid size for a ring token', () => {
    expect(
      tokenPortrait({
        texture: { src: 'art/Avatar.webp', scaleX: 1, scaleY: 1 },
        ring: {
          enabled: true,
          colors: { ring: '#ed662c', background: null },
          subject: { texture: 'art/Token.webp', scale: 2 }
        },
        width: 2,
        height: 3
      }).ring
    ).toEqual({
      ringColor: '#ed662c',
      backgroundColor: null,
      // Foundry matches the ring to the smaller dimension.
      gridSize: 2
    })
  })

  it('normalizes a prepared Color instance back to a hex string', () => {
    // Foundry's prepared documents hold Color objects (a Number subclass); only
    // source data over the socket is a plain string.
    class Color extends Number {}
    expect(
      tokenPortrait({
        texture: { src: 'art/a.webp' },
        ring: { enabled: true, colors: { ring: new Color(0xed662c) }, subject: { scale: 1 } }
      }).ring?.ringColor
    ).toBe('#ed662c')
  })

  it('defaults the grid size to 1 when the token declares no footprint', () => {
    expect(
      tokenPortrait({ texture: { src: 'a.webp' }, ring: { enabled: true } }).ring?.gridSize
    ).toBe(1)
  })

  it('reports no ring for a token that does not draw one', () => {
    expect(tokenPortrait({ texture: { src: 'a.webp' } }).ring).toBeUndefined()
    expect(
      tokenPortrait({ texture: { src: 'a.webp' }, ring: { enabled: false } }).ring
    ).toBeUndefined()
  })

  it('falls back to the base texture when a ring has no subject art', () => {
    expect(
      tokenPortrait({
        texture: { src: 'art/goblin.webp', scaleX: 1, scaleY: 1 },
        ring: { enabled: true, subject: { scale: 1.7 } }
      })
    ).toMatchObject({ url: 'art/goblin.webp', scaleX: 1.7, scaleY: 1.7 })
  })

  it('keeps the mirror flags a ring token stores as a negative texture scale', () => {
    expect(
      tokenPortrait({
        texture: { src: 'art/Avatar.webp', scaleX: -2, scaleY: 2 },
        ring: { enabled: true, subject: { texture: 'art/Token.webp', scale: 1.5 } }
      })
    ).toMatchObject({ url: 'art/Token.webp', scaleX: -1.5, scaleY: 1.5 })
  })

  it('ignores a disabled ring', () => {
    expect(
      tokenPortrait({
        texture: { src: 'art/goblin.webp', scaleX: 1, scaleY: 1 },
        ring: { enabled: false, subject: { texture: 'art/subject.webp', scale: 2 } }
      })
    ).toEqual({ url: 'art/goblin.webp', scaleX: 1, scaleY: 1 })
  })

  it('falls back to the actor image and tolerates a missing token', () => {
    expect(tokenPortrait({ texture: {} }, 'art/actor.webp').url).toBe('art/actor.webp')
    expect(tokenPortrait(undefined, 'art/actor.webp').url).toBe('art/actor.webp')
    expect(tokenPortrait(undefined)).toEqual({ url: undefined, scaleX: 1, scaleY: 1 })
  })
})
