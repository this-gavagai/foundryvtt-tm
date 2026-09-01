import { describe, expect, it } from 'vitest'
import {
  addCounts,
  coinCounts,
  coinDenomination,
  coinStacks,
  copperValue,
  emptyCounts,
  formatGold,
  hasChange,
  type CoinLike
} from '@/utils/coins'
// Minimal wire-shaped items: what an inventory looks like once it has crossed
// the socket. The coin readers are typed against what they read (CoinLike), so
// these doubles carry only those fields and need no cast.
const METAL: Record<string, string> = {
  pp: 'platinum',
  gp: 'gold',
  sp: 'silver',
  cp: 'copper'
}

function coin(denomination: string, quantity: number, overrides: Partial<CoinLike['system']> = {}) {
  return {
    _id: `${denomination}-stack`,
    type: 'treasure',
    system: {
      slug: `${METAL[denomination]}-pieces`,
      stackGroup: 'coins',
      quantity,
      price: { value: { [denomination]: 1 } },
      ...overrides
    }
  }
}

describe('coin identification', () => {
  it('reads the denomination off the price of a coin stack', () => {
    expect(coinDenomination(coin('gp', 12))).toBe('gp')
    expect(coinDenomination(coin('pp', 3))).toBe('pp')
  })

  it('falls back on the slug when the price did not survive the wire', () => {
    const priceless = coin('sp', 4, { price: { value: {} } })
    expect(coinDenomination(priceless)).toBe('sp')
  })

  it('ignores treasure that is not coinage', () => {
    const gem = {
      _id: 'gem',
      type: 'treasure',
      system: { slug: 'sapphire', stackGroup: null, quantity: 1, price: { value: { gp: 50 } } }
    }
    expect(coinDenomination(gem)).toBeUndefined()
  })

  it('ignores a non-treasure item priced in gold', () => {
    const sword = {
      _id: 'sword',
      type: 'weapon',
      system: { slug: 'longsword', stackGroup: null, quantity: 1, price: { value: { gp: 1 } } }
    }
    expect(coinDenomination(sword)).toBeUndefined()
  })
})

describe('reading a purse', () => {
  it('counts each denomination, and zero for one that has no stack', () => {
    expect(coinCounts([coin('gp', 143), coin('sp', 27)])).toEqual({
      pp: 0,
      gp: 143,
      sp: 27,
      cp: 0
    })
  })

  it('edits the largest stack when an import left two of a denomination', () => {
    const small = coin('gp', 2)
    const large = { ...coin('gp', 900), _id: 'gp-hoard' }
    expect(coinStacks([small, large]).gp?._id).toBe('gp-hoard')
  })

  it('values a purse in copper', () => {
    expect(copperValue({ pp: 1, gp: 2, sp: 3, cp: 4 })).toBe(1234)
    expect(copperValue({})).toBe(0)
  })
})

describe('draft arithmetic', () => {
  it('adds a delta set to a count set', () => {
    expect(addCounts({ pp: 0, gp: 10, sp: 5, cp: 0 }, { gp: -4, cp: 7 })).toEqual({
      pp: 0,
      gp: 6,
      sp: 5,
      cp: 7
    })
  })

  it('recognises an empty draft', () => {
    expect(hasChange(emptyCounts())).toBe(false)
    expect(hasChange({ ...emptyCounts(), cp: -1 })).toBe(true)
  })
})

describe('formatGold', () => {
  it('drops the decimals on a round purse', () => {
    expect(formatGold(14300)).toBe('143 gp')
  })

  it('keeps two decimals when there is sub-gold change', () => {
    expect(formatGold(15858)).toBe('158.58 gp')
  })
})
