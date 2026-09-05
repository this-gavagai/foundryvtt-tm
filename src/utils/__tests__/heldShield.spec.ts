import { describe, it, expect } from 'vitest'
import { heldShield, type ShieldSource } from '@/utils/heldShield'

// PF2e copies its creature shield block off the held shield item, so the block
// is absent from source data and the sheet's shield readout disappears on a
// world-dump sheet. These pin the copy — and the selection rule behind it.

function shield(over: Partial<ShieldSource['system']> & { _id?: string } = {}): ShieldSource {
  const { _id, ...system } = over
  return {
    _id: _id ?? 'shield-1',
    type: 'shield',
    system: {
      acBonus: 2,
      hardness: 5,
      hp: { value: 20, max: 20 },
      usage: { value: 'held-in-one-hand' },
      equipped: { carryType: 'held', handsHeld: 1 },
      ...system
    }
  }
}

describe('selection', () => {
  it('finds nothing when no shield is held', () => {
    expect(heldShield([])).toBeNull()
    expect(heldShield(undefined)).toBeNull()
    expect(heldShield([shield({ equipped: { carryType: 'worn', handsHeld: 0 } })])).toBeNull()
  })

  it('ignores a shield that is carried rather than held', () => {
    // A shield in the pack contributes nothing, exactly as PF2e's isEquipped says.
    expect(heldShield([shield({ equipped: { carryType: 'carried', handsHeld: 0 } })])).toBeNull()
  })

  it('needs both hands for a two-hand shield', () => {
    const usage = { value: 'held-in-two-hands' }
    expect(heldShield([shield({ usage, equipped: { carryType: 'held', handsHeld: 1 } })])).toBeNull()
    expect(
      heldShield([shield({ usage, equipped: { carryType: 'held', handsHeld: 2 } })])?.itemId
    ).toBe('shield-1')
  })

  it('prefers the better AC bonus when two are held', () => {
    // PF2e's tie-break order is AC, then remaining HP, then hardness. Unusual to
    // hit, but it decides which shield the readout is about.
    const best = heldShield([
      shield({ _id: 'buckler', acBonus: 1 }),
      shield({ _id: 'tower', acBonus: 4 })
    ])
    expect(best?.itemId).toBe('tower')
  })

  it('falls to remaining hit points when the AC bonus ties', () => {
    const best = heldShield([
      shield({ _id: 'battered', hp: { value: 3, max: 20 } }),
      shield({ _id: 'fresh', hp: { value: 18, max: 20 } })
    ])
    expect(best?.itemId).toBe('fresh')
  })

  it('falls to hardness when AC and hit points both tie', () => {
    const best = heldShield([
      shield({ _id: 'wooden', hardness: 3 }),
      shield({ _id: 'steel', hardness: 5 })
    ])
    expect(best?.itemId).toBe('steel')
  })
})

describe('the copied block', () => {
  it('mirrors PF2e: ac, hardness, hp and half-max broken threshold', () => {
    expect(heldShield([shield({ acBonus: 2, hardness: 5, hp: { value: 14, max: 20 } })])).toEqual({
      itemId: 'shield-1',
      ac: 2,
      hardness: 5,
      hp: { value: 14, max: 20, brokenThreshold: 10 },
      broken: false,
      destroyed: false
    })
  })

  it('rounds the broken threshold down', () => {
    expect(heldShield([shield({ hp: { value: 9, max: 9 } })])?.hp.brokenThreshold).toBe(4)
  })

  it('is broken at or below the threshold, and not also destroyed', () => {
    const result = heldShield([shield({ hp: { value: 10, max: 20 } })])
    expect(result?.broken).toBe(true)
    expect(result?.destroyed).toBe(false)
  })

  it('is destroyed rather than broken at zero', () => {
    // PF2e's isBroken excludes a destroyed shield explicitly; both flags being
    // true would let the sheet show two contradictory states at once.
    const result = heldShield([shield({ hp: { value: 0, max: 20 } })])
    expect(result?.destroyed).toBe(true)
    expect(result?.broken).toBe(false)
  })

  it('is neither for a shield with no hit points recorded', () => {
    const result = heldShield([shield({ hp: { value: 0, max: 0 } })])
    expect(result?.broken).toBe(false)
    expect(result?.destroyed).toBe(false)
  })
})
