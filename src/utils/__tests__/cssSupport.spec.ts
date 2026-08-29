import { describe, it, expect, afterEach } from 'vitest'
import { supportsModernCss } from '@/utils/cssSupport'

const original = globalThis.CSS

function stubCss(value: unknown) {
  Object.defineProperty(globalThis, 'CSS', { value, configurable: true, writable: true })
}

afterEach(() => {
  stubCss(original)
})

describe('supportsModernCss', () => {
  it('probes oklch(), the highest of the features Tailwind v4 emits', () => {
    const seen: [string, string][] = []
    stubCss({
      supports: (property: string, value: string) => {
        seen.push([property, value])
        return true
      }
    })

    expect(supportsModernCss()).toBe(true)
    expect(seen).toEqual([['color', 'oklch(0 0 0)']])
  })

  it('reports unsupported when the engine rejects oklch (WebView below 111)', () => {
    stubCss({ supports: () => false })
    expect(supportsModernCss()).toBe(false)
  })

  // Engines old enough to lack CSS.supports entirely are far below the floor,
  // so absence is treated as unsupported rather than throwing on startup.
  it('reports unsupported when CSS.supports is missing', () => {
    stubCss({})
    expect(supportsModernCss()).toBe(false)
  })

  it('reports unsupported when CSS itself is undefined', () => {
    stubCss(undefined)
    expect(supportsModernCss()).toBe(false)
  })
})
