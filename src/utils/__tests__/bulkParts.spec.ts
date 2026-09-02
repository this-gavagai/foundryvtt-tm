import { describe, it, expect } from 'vitest'
import { bulkParts } from '@/utils/formatters'

// Bulk reaches the app as a float of tenths (0.1 per "light" item), and is read
// back as two units: whole Bulk and light. The split has to survive float
// addition, since a container's contents bulk is a sum.

describe('bulkParts', () => {
  it('splits whole Bulk from light', () => {
    expect(bulkParts(0)).toEqual({ normal: 0, light: 0 })
    expect(bulkParts(0.6)).toEqual({ normal: 0, light: 6 })
    expect(bulkParts(3)).toEqual({ normal: 3, light: 0 })
    expect(bulkParts(2.3)).toEqual({ normal: 2, light: 3 })
  })

  it('rounds the float rather than flooring it', () => {
    // Ten light items summed by repeated addition; flooring reads 9L, which is
    // a Bulk the player does not have and a unit they never see.
    const tenLight = Array.from({ length: 10 }).reduce<number>((sum) => sum + 0.1, 0)
    expect(tenLight).not.toBe(1)
    expect(bulkParts(tenLight)).toEqual({ normal: 1, light: 0 })
  })

  it('treats a missing or negative value as nothing carried', () => {
    expect(bulkParts(undefined)).toEqual({ normal: 0, light: 0 })
    expect(bulkParts(-1)).toEqual({ normal: 0, light: 0 })
  })
})
