import { copperValue, type CoinCounts, type Denomination } from '@/utils/coins'

// An item's level and price, when a rune has moved them.
//
// PF2e recomputes both in `computeLevelRarityPrice`, and the shape of that
// function is the whole reason this is worth doing narrowly rather than fully:
// it EARLY-EXITS. An item that is not magical and has no precious material and
// no grade keeps its own stored level and rarity, and `computePrice` hands back
// the stored price untouched. Measured across ten live characters, that is 207
// of 225 physical items — they were already right, and this must not touch them.
//
// Of the 18 that move, 14 carry only FUNDAMENTAL runes (potency, striking,
// resilient, reinforcing). Those are core-rulebook values: sixteen numbers that
// have not changed in years and do not grow when a book ships. They are here.
//
// The other four need content that does grow with every book — property runes
// (~180 entries), precious materials, item grades. Those are NOT here, and an
// item carrying one is reported provisional rather than guessed at. Half a
// valuation shown as fact is worse than a stored price shown as a stored price.

interface RuneValue {
  level: number
  price: number
}

// Straight from the system's own tables. Index is the rune's numeric value; 0
// is "absent" and has no entry.
const WEAPON_POTENCY: Record<number, RuneValue> = {
  1: { level: 2, price: 35 },
  2: { level: 10, price: 935 },
  3: { level: 16, price: 8935 },
  4: { level: 20, price: 70000 }
}
const STRIKING: Record<number, RuneValue> = {
  1: { level: 4, price: 65 },
  2: { level: 12, price: 1065 },
  3: { level: 19, price: 31065 },
  4: { level: 20, price: 70000 }
}
const ARMOR_POTENCY: Record<number, RuneValue> = {
  1: { level: 5, price: 160 },
  2: { level: 11, price: 1060 },
  3: { level: 18, price: 20560 },
  4: { level: 20, price: 70000 }
}
const RESILIENT: Record<number, RuneValue> = {
  1: { level: 8, price: 340 },
  2: { level: 14, price: 3440 },
  3: { level: 20, price: 49440 },
  4: { level: 20, price: 70000 }
}
const REINFORCING: Record<number, RuneValue> = {
  1: { level: 4, price: 75 },
  2: { level: 7, price: 300 },
  3: { level: 10, price: 900 },
  4: { level: 13, price: 2500 }
}

export interface ValuedItem {
  type?: string
  system?: {
    level?: { value?: number }
    price?: { value?: Partial<CoinCounts>; sizeSensitive?: boolean }
    size?: string
    specific?: boolean
    shoddy?: boolean
    material?: { type?: string | null; grade?: string | null }
    grade?: string | null
    runes?: {
      potency?: number
      striking?: number
      resilient?: number
      reinforcing?: number
      property?: unknown
    }
  }
}

export interface ItemValuation {
  level: number | undefined
  price: Partial<CoinCounts> | undefined
  // True when something the engine does not model could have moved these — a
  // property rune, a precious material, a grade. The stored values are returned
  // unchanged in that case, which is the honest direction: understated rather
  // than invented.
  provisional: boolean
  caveat?: string
}

// `property` arrives as an array normally and as an object with numeric keys
// from at least one live actor, so length is counted rather than assumed.
function propertyRuneCount(property: unknown): number {
  if (Array.isArray(property)) return property.filter(Boolean).length
  if (property && typeof property === 'object') {
    return Object.values(property as Record<string, unknown>).filter(Boolean).length
  }
  return 0
}

function fundamentals(item: ValuedItem): RuneValue[] {
  const runes = item.system?.runes ?? {}
  const out: RuneValue[] = []
  const take = (table: Record<number, RuneValue>, value: number | undefined) => {
    const entry = value ? table[value] : undefined
    if (entry) out.push(entry)
  }
  if (item.type === 'armor') {
    take(ARMOR_POTENCY, runes.potency)
    take(RESILIENT, runes.resilient)
  } else if (item.type === 'shield') {
    take(REINFORCING, runes.reinforcing)
  } else {
    take(WEAPON_POTENCY, runes.potency)
    take(STRIKING, runes.striking)
  }
  return out
}

export function deriveItemValuation(item: ValuedItem | undefined): ItemValuation {
  const level = item?.system?.level?.value
  const price = item?.system?.price?.value
  const stored: ItemValuation = { level, price, provisional: false }
  if (!item) return stored

  // A specific magic item's level and price ARE its stored ones: PF2e exits
  // before any rune is valued.
  if (item.system?.specific) return stored

  const unmodelled: string[] = []
  if (propertyRuneCount(item.system?.runes?.property)) unmodelled.push('property rune')
  if (item.system?.material?.type) unmodelled.push('precious material')
  if (item.system?.grade) unmodelled.push('item grade')
  // Both are simple multipliers PF2e applies AFTER the rune total, and neither
  // appears on the test table — so they are named rather than half-applied.
  if (item.system?.shoddy) unmodelled.push('shoddy')
  if (
    item.system?.size &&
    item.system.size !== 'med' &&
    item.system.price?.sizeSensitive !== false
  ) {
    unmodelled.push('non-medium size')
  }
  if (unmodelled.length) {
    return { ...stored, provisional: true, caveat: `not valued: ${unmodelled.join(', ')}` }
  }

  const runes = fundamentals(item)
  if (runes.length === 0) return stored

  // PF2e DISCARDS the base price once a rune is on the item — a +1 dagger costs
  // 35gp, not 35gp plus the dagger. Verified against a live one: 2sp becomes
  // exactly 35gp. The stored price only wins when it is the larger of the two.
  const runeGold = runes.reduce((sum, rune) => sum + rune.price, 0)
  const runePrice: Partial<CoinCounts> = { gp: runeGold }
  const better =
    copperValue(runePrice) > copperValue((price ?? {}) as Partial<Record<Denomination, number>>)
      ? runePrice
      : price

  return {
    level: Math.max(...runes.map((rune) => rune.level), level ?? 0),
    price: better,
    provisional: false
  }
}

// The valuation to SHOW for an item, given that the payload may already carry
// PF2e's own.
//
// The gate is the overlay record the Foundry side leaves behind
// (utils/itemSource.ts): it writes one whenever a prepared value displaced a
// different stored value, and writes nothing when the two agree. So an entry for
// `system.price.value` means PF2e has already valued this item and its answer
// stands; no entry means either the world dump, or a prepared item PF2e did not
// move — and on a prepared item PF2e did not move, there is nothing here to move
// either, so recomputing is a no-op.
//
// That is what lets this run on both paths without a "which path am I on" test,
// the same property the IWR merge rests on.
export function displayedValuation(
  item: ValuedItem | undefined,
  overlaidPaths: readonly string[]
): ItemValuation {
  const stored: ItemValuation = {
    level: item?.system?.level?.value,
    price: item?.system?.price?.value,
    provisional: false
  }
  if (overlaidPaths.includes('system.price.value')) return stored
  return deriveItemValuation(item)
}
