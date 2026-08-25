import { describe, expect, it } from 'vitest'
import {
  parseColor,
  parseRingSheet,
  pickRingSize,
  resolveRingColor,
  tintBackgroundPixels,
  tintRingPixels
} from '../tokenRingAssets'

// Shaped like Foundry's core rings-steel.json.
const CORE_SHEET = {
  config: { defaultColorBand: { startRadius: 0.666, endRadius: 0.7225 } },
  frames: {
    'token-ring-gargantuan-bkg': { frame: { x: 0, y: 0, w: 2048, h: 2048 } },
    'token-ring-gargantuan': { frame: { x: 2048, y: 0, w: 2048, h: 2048 }, gridTarget: 4 },
    'token-ring-med-bkg': { frame: { x: 2048, y: 2048, w: 512, h: 512 } },
    'token-ring-med': { frame: { x: 2560, y: 2048, w: 512, h: 512 }, gridTarget: 1 }
  },
  meta: { image: 'rings-steel.webp' }
}

// Shaped like an adventure module's custom ring: one size class, its own
// default color, and a band covering the whole frame.
const CUSTOM_SHEET = {
  config: { defaultRingColor: '#ed662c' },
  frames: {
    'token-ring-bkg': { frame: { x: 0, y: 0, w: 2048, h: 2048 } },
    'token-ring': {
      frame: { x: 2048, y: 0, w: 2048, h: 2048 },
      colorBand: { startRadius: 0, endRadius: 1.5 },
      ringColor: '#ed662c'
    }
  },
  meta: { image: 'custom-ring.webp' }
}

describe('parseRingSheet', () => {
  it('pairs each ring frame with its background and sorts by grid target', () => {
    const sheet = parseRingSheet(CORE_SHEET)
    expect(sheet.sizes.map((s) => [s.ringName, s.bkgName, s.gridTarget])).toEqual([
      ['token-ring-med', 'token-ring-med-bkg', 1],
      ['token-ring-gargantuan', 'token-ring-gargantuan-bkg', 4]
    ])
    expect(sheet.frames['token-ring-med']).toEqual({ x: 2560, y: 2048, w: 512, h: 512 })
  })

  it('applies the sheet-level color band when a frame declares none', () => {
    expect(parseRingSheet(CORE_SHEET).sizes[0].colorBand).toEqual({
      startRadius: 0.666,
      endRadius: 0.7225
    })
  })

  it("falls back to Foundry's built-in band when the sheet declares none", () => {
    const sheet = parseRingSheet({ frames: { ring: { frame: { x: 0, y: 0, w: 8, h: 8 } } } })
    expect(sheet.sizes[0].colorBand).toEqual({ startRadius: 0.59, endRadius: 0.7225 })
  })

  it('reads a frame-level band, color, and an unsuffixed frame name', () => {
    const [size] = parseRingSheet(CUSTOM_SHEET).sizes
    expect(size).toMatchObject({
      ringName: 'token-ring',
      bkgName: 'token-ring-bkg',
      gridTarget: 1,
      colorBand: { startRadius: 0, endRadius: 1.5 },
      defaultRingColor: '#ed662c'
    })
  })

  it('never treats a background or mask frame as a ring', () => {
    const sheet = parseRingSheet({
      frames: {
        'r-bkg': { frame: { x: 0, y: 0, w: 4, h: 4 } },
        'r-msk': { frame: { x: 4, y: 0, w: 4, h: 4 } },
        r: { frame: { x: 8, y: 0, w: 4, h: 4 } }
      }
    })
    expect(sheet.sizes.map((s) => s.ringName)).toEqual(['r'])
  })
})

describe('pickRingSize', () => {
  const sheet = parseRingSheet(CORE_SHEET)

  it('picks the nearest grid target', () => {
    expect(pickRingSize(sheet, 1)?.ringName).toBe('token-ring-med')
    expect(pickRingSize(sheet, 4)?.ringName).toBe('token-ring-gargantuan')
    // 3 is closer to 4 than to 1.
    expect(pickRingSize(sheet, 3)?.ringName).toBe('token-ring-gargantuan')
  })

  it('tolerates a sheet with a single size class and a missing footprint', () => {
    const custom = parseRingSheet(CUSTOM_SHEET)
    expect(pickRingSize(custom, 4)?.ringName).toBe('token-ring')
    expect(pickRingSize(sheet, NaN)?.ringName).toBe('token-ring-med')
    expect(pickRingSize(parseRingSheet({ frames: {} }), 1)).toBeUndefined()
  })
})

describe('parseColor', () => {
  it('reads hex strings, shorthand, and packed numbers', () => {
    expect(parseColor('#ed662c')).toEqual([0xed, 0x66, 0x2c])
    expect(parseColor('ed662c')).toEqual([0xed, 0x66, 0x2c])
    expect(parseColor('#fff')).toEqual([255, 255, 255])
    expect(parseColor(0xed662c)).toEqual([0xed, 0x66, 0x2c])
  })

  it('rejects anything it cannot read', () => {
    expect(parseColor(null)).toBeUndefined()
    expect(parseColor(undefined)).toBeUndefined()
    expect(parseColor('')).toBeUndefined()
    expect(parseColor('not-a-color')).toBeUndefined()
  })
})

describe('resolveRingColor', () => {
  it("uses the token's own color when it has one", () => {
    expect(resolveRingColor('#ed662c', '#123456')).toEqual([0xed, 0x66, 0x2c])
  })

  it("falls back to the sheet default when the token's color is absent or white", () => {
    // Foundry reads a null color as white, and white defers to the default.
    expect(resolveRingColor(null, '#ed662c')).toEqual([0xed, 0x66, 0x2c])
    expect(resolveRingColor('#ffffff', '#ed662c')).toEqual([0xed, 0x66, 0x2c])
  })

  it('stays white when neither side offers a color', () => {
    expect(resolveRingColor(null, null)).toEqual([255, 255, 255])
  })
})

// A 4×4 frame: pixel centres sit at normalized radii of roughly 0.35 (the four
// middle pixels) and up to 1.06 (the corners).
function frame(fill: [number, number, number, number]): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(4 * 4 * 4)
  for (let i = 0; i < pixels.length; i += 4) pixels.set(fill, i)
  return pixels
}

describe('tintRingPixels', () => {
  it('replaces color inside the band with the ring color weighted by red', () => {
    const pixels = frame([128, 20, 20, 255])
    tintRingPixels(pixels, 4, [0, 100, 200], { startRadius: 0, endRadius: 2 })
    // red 128/255 ≈ 0.502 scales the tint; alpha is untouched.
    expect([...pixels.slice(0, 4)]).toEqual([0, 50, 100, 255])
  })

  it('leaves pixels outside the band untouched — that is the metal bezel', () => {
    const pixels = frame([128, 20, 20, 255])
    tintRingPixels(pixels, 4, [0, 100, 200], { startRadius: 0.9, endRadius: 1.0 })
    // The four central pixels sit at ~0.35, well inside the band's hole.
    expect([...pixels.slice(4 * 5, 4 * 5 + 4)]).toEqual([128, 20, 20, 255])
  })

  it('skips fully transparent pixels', () => {
    const pixels = frame([128, 20, 20, 0])
    tintRingPixels(pixels, 4, [0, 100, 200], { startRadius: 0, endRadius: 2 })
    expect([...pixels.slice(0, 4)]).toEqual([128, 20, 20, 0])
  })
})

describe('tintBackgroundPixels', () => {
  it('overlay-blends dark and light bases on opposite branches', () => {
    // base 0.25 (< 0.5) multiplies: 2 × 0.25 × 0.5 = 0.25 → 64
    const dark = frame([64, 64, 64, 255])
    tintBackgroundPixels(dark, [128, 128, 128])
    expect(dark[0]).toBe(64)

    // base 0.75 (>= 0.5) screens: 1 − 2 × 0.25 × 0.5 = 0.75 → 191
    const light = frame([191, 191, 191, 255])
    tintBackgroundPixels(light, [128, 128, 128])
    expect(light[0]).toBeCloseTo(191, 0)
  })

  it('leaves transparent pixels alone', () => {
    const pixels = frame([64, 64, 64, 0])
    tintBackgroundPixels(pixels, [255, 0, 0])
    expect([...pixels.slice(0, 4)]).toEqual([64, 64, 64, 0])
  })
})
