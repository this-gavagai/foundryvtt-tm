import { describe, it, expect } from 'vitest'
import { bulkParts, stackBulk } from '@/utils/formatters'

// PF2e's PhysicalItemPF2e#bulk, which this mirrors:
//
//   const per = this.system.bulk.per
//   return new Bulk(this.system.bulk.value).times(Math.floor(this.quantity / per))
//
// The floor is the whole point: `per` is the quantity a Bulk value is quoted
// for, and a stack short of it is negligible. Dividing the product instead —
// what the inventory row used to do, and against `price.per` rather than
// `bulk.per` at that — bills a partial stack for a partial Bulk.

describe('stackBulk', () => {
  it('weighs a full stack the way PF2e does', () => {
    // Arrows: 1 light per 10, so a full quiver is one light.
    expect(stackBulk(0.1, 10, 10)).toBeCloseTo(0.1)
    expect(stackBulk(0.1, 30, 10)).toBeCloseTo(0.3)
  })

  it('floors the stack count before multiplying, not after', () => {
    // 5 arrows are negligible; 15 weigh exactly what 10 do. Dividing the
    // product would read 0.05 and 0.15 — half-lights, a unit PF2e has not got.
    expect(stackBulk(0.1, 5, 10)).toBe(0)
    expect(stackBulk(0.1, 15, 10)).toBeCloseTo(0.1)
    expect(stackBulk(0.1, 19, 10)).toBeCloseTo(0.1)
  })

  it('reads a missing or unstacked `per` as 1', () => {
    // Every item that doesn't stack omits `per`, as does every item in a
    // payload from a Foundry-side build that predates it being sent.
    expect(stackBulk(1, 3, undefined)).toBe(3)
    expect(stackBulk(1, 3, 1)).toBe(3)
    // A zero or negative `per` would divide the stack away entirely.
    expect(stackBulk(1, 3, 0)).toBe(3)
  })

  it('treats a negligible, missing or absent-quantity bulk as nothing', () => {
    expect(stackBulk(0, 12, 1)).toBe(0)
    expect(stackBulk(undefined, 12, 1)).toBe(0)
    expect(stackBulk(1, undefined, 1)).toBe(0)
  })

  it('does not confuse `bulk.per` with `price.per`', () => {
    // Backpack ballista bolts: PF2e sets price.per to 10 while bulk.per stays
    // 1, so each bolt carries its own Bulk. Against the price denominator the
    // row read a tenth of the truth.
    expect(stackBulk(1, 10, 1)).toBe(10)
  })

  it('survives the float drift that a tenths-based Bulk invites', () => {
    // 0.1 × 7 is 0.7000000000000001. bulkParts is what the row formats with,
    // and it rounds into light units rather than flooring them.
    expect(bulkParts(stackBulk(0.1, 70, 10))).toEqual({ normal: 0, light: 7 })
    expect(bulkParts(stackBulk(0.1, 100, 10))).toEqual({ normal: 1, light: 0 })
  })
})
