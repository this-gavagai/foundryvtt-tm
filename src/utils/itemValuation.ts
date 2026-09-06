import { copperValue, type CoinCounts, type Denomination } from '@/utils/coins'
import {
  ARMOR_PROPERTY_RUNES,
  GRADES,
  MATERIALS,
  WEAPON_PROPERTY_RUNES,
  rarityOf,
  type RuneValue
} from '@/utils/pf2eValuationTables'

// An item's level, rarity and price, as PF2e's `computeLevelRarityPrice` and
// `computePrice` produce them.
//
// The shape of those two functions is why this is worth doing at all: they
// EARLY-EXIT. An item that is not magical and has no precious material and no
// grade keeps its stored level and rarity, and its price comes back untouched.
// Measured across ten live characters that is 207 of 225 physical items.
//
// The rest need valuation tables, and PF2e keeps those module-private. They are
// transcribed in ./pf2eValuationTables — read the warning at the top of that
// file before trusting a number from it across a system upgrade.

// PF2e's fundamental runes, which are core-rulebook values rather than content
// that grows with each book.
const WEAPON_POTENCY: Record<number, RuneValue> = {
  1: { l: 2, p: 35, r: 'c' },
  2: { l: 10, p: 935, r: 'c' },
  3: { l: 16, p: 8935, r: 'c' },
  4: { l: 20, p: 70000, r: 'r' }
}
const STRIKING: Record<number, RuneValue> = {
  1: { l: 4, p: 65, r: 'c' },
  2: { l: 12, p: 1065, r: 'c' },
  3: { l: 19, p: 31065, r: 'c' },
  4: { l: 20, p: 70000, r: 'r' }
}
const ARMOR_POTENCY: Record<number, RuneValue> = {
  1: { l: 5, p: 160, r: 'c' },
  2: { l: 11, p: 1060, r: 'c' },
  3: { l: 18, p: 20560, r: 'c' },
  4: { l: 20, p: 70000, r: 'r' }
}
const RESILIENT: Record<number, RuneValue> = {
  1: { l: 8, p: 340, r: 'c' },
  2: { l: 14, p: 3440, r: 'c' },
  3: { l: 20, p: 49440, r: 'c' },
  4: { l: 20, p: 70000, r: 'r' }
}
const REINFORCING: Record<number, RuneValue> = {
  1: { l: 4, p: 75, r: 'c' },
  2: { l: 7, p: 300, r: 'c' },
  3: { l: 10, p: 900, r: 'c' },
  4: { l: 13, p: 2500, r: 'c' }
}

export interface ValuedItem {
  type?: string
  system?: {
    level?: { value?: number }
    price?: { value?: Partial<CoinCounts>; sizeSensitive?: boolean }
    size?: string
    specific?: unknown
    // PF2e reads shoddy off `traits.otherTags`, not off a boolean field.
    traits?: { otherTags?: string[]; value?: string[]; rarity?: string }
    bulk?: { heldOrStowed?: number; value?: number }
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
  rarity: string | undefined
  price: Partial<CoinCounts> | undefined
  // True when something the engine does not model could have moved these — a
  // property rune, a precious material, a grade. The stored values are returned
  // unchanged in that case, which is the honest direction: understated rather
  // than invented.
  provisional: boolean
  caveat?: string
}

// The runes PF2e values on this item, fundamentals and property alike.
function runeValues(item: ValuedItem): RuneValue[] {
  const runes = item.system?.runes ?? {}
  const out: RuneValue[] = []
  const take = (table: Record<number, RuneValue>, value: number | undefined) => {
    const entry = value ? table[value] : undefined
    if (entry) out.push(entry)
  }
  const property = item.type === 'armor' ? ARMOR_PROPERTY_RUNES : WEAPON_PROPERTY_RUNES
  if (item.type === 'armor') {
    take(ARMOR_POTENCY, runes.potency)
    take(RESILIENT, runes.resilient)
  } else if (item.type === 'shield') {
    take(REINFORCING, runes.reinforcing)
  } else {
    take(WEAPON_POTENCY, runes.potency)
    take(STRIKING, runes.striking)
  }
  for (const slug of propertyRuneSlugs(runes.property)) {
    const entry = property[slug]
    if (entry) out.push(entry)
  }
  return out
}

function propertyRuneSlugs(property: unknown): string[] {
  const list = Array.isArray(property)
    ? property
    : property && typeof property === 'object'
      ? Object.values(property as Record<string, unknown>)
      : []
  return list.filter((entry): entry is string => typeof entry === 'string' && !!entry)
}

// Which material table an item reads, since PF2e prices the same material
// differently for a buckler, a shield and a tower shield.
function materialValue(item: ValuedItem): RuneValue | undefined {
  const { type: material, grade } = item.system?.material ?? {}
  if (!material || !grade) return undefined
  const traits = item.system?.traits?.value ?? []
  const kind =
    item.type === 'shield'
      ? traits.includes('buckler')
        ? 'buckler'
        : traits.includes('tower')
          ? 'towerShield'
          : 'shield'
      : item.type === 'armor'
        ? 'armor'
        : 'weapon'
  return MATERIALS[kind]?.[material]?.[grade]
}

function gradeValue(item: ValuedItem): { level: number; price: number } {
  const grade = item.system?.grade
  if (!grade || !item.type || !['weapon', 'armor', 'shield'].includes(item.type)) {
    return { level: 0, price: 0 }
  }
  const entry = GRADES[item.type]?.[grade]
  return entry ? { level: entry.l, price: entry.c / 10 } : { level: 0, price: 0 }
}

const RARITY_ORDER: Record<string, number> = { common: 0, uncommon: 1, rare: 2, unique: 3 }

// PF2e scales a price by item size when the price is size-sensitive.
const SIZE_SCALE: Record<string, number> = { lg: 2, huge: 4, grg: 8 }

function scaleCoins(price: Partial<CoinCounts>, factor: number): Partial<CoinCounts> {
  const out: Partial<CoinCounts> = {}
  for (const d of ['pp', 'gp', 'sp', 'cp'] as Denomination[]) {
    if (price[d] !== undefined) out[d] = (price[d] ?? 0) * factor
  }
  return out
}

// `computePrice`, reproduced. The order matters and is not obvious: the base
// price is DISCARDED once a rune or material is on the item, a shield's
// reinforcing rune is held back from that comparison and added afterwards, and
// only then do shoddy and size apply.
function computePrice(item: ValuedItem): Partial<CoinCounts> | undefined {
  const stored = item.system?.price?.value
  if (item.type === 'treasure') return stored
  const specific = !!item.system?.specific

  const material = materialValue(item)
  const materialPrice = material?.p ?? 0
  // Material cost scales with the item's Bulk, except on shields.
  const bulk = Math.max(
    Math.floor(item.system?.bulk?.heldOrStowed ?? item.system?.bulk?.value ?? 0),
    1
  )
  const materialTotal = specific ? 0 : materialPrice + (bulk * materialPrice) / 10

  const reinforcing =
    item.type !== 'shield' || specific
      ? 0
      : (REINFORCING[item.system?.runes?.reinforcing ?? 0]?.p ?? 0)
  const runeTotal = specific
    ? 0
    : runeValues(item).reduce((sum, rune) => sum + rune.p, 0) - reinforcing

  const zeroed = materialTotal > 0 || runeTotal > 0
  const base: Partial<CoinCounts> = zeroed ? {} : (stored ?? {})
  const grade = specific ? 0 : gradeValue(item).price

  const built: Partial<CoinCounts> = runeTotal
    ? { gp: runeTotal + materialTotal }
    : addGold(base, grade + materialTotal)
  const best = copperValue(built) > copperValue(base) ? built : base
  const withReinforcing = addGold(best, reinforcing)

  const shoddy = item.system?.traits?.otherTags?.includes('shoddy')
  const afterShoddy = shoddy ? scaleCoins(withReinforcing, 0.5) : withReinforcing
  if (item.system?.price?.sizeSensitive === false) return afterShoddy
  const scale = SIZE_SCALE[item.system?.size ?? 'med']
  return scale ? scaleCoins(afterShoddy, scale) : afterShoddy
}

function addGold(price: Partial<CoinCounts>, gold: number): Partial<CoinCounts> {
  if (!gold) return { ...price }
  return { ...price, gp: (price.gp ?? 0) + gold }
}

export function deriveItemValuation(item: ValuedItem | undefined): ItemValuation {
  const level = item?.system?.level?.value
  const rarity = item?.system?.traits?.rarity
  const stored: ItemValuation = {
    level,
    rarity,
    price: item?.system?.price?.value,
    provisional: false
  }
  if (!item) return stored

  const price = computePrice(item)
  const material = materialValue(item)
  const grade = gradeValue(item)
  // `isMagical` in PF2e is a trait test; a rune is what puts the trait there,
  // so the presence of any rune stands in for it and a magical trait is
  // honoured directly.
  const runes = runeValues(item)
  const magical = runes.length > 0 || !!item.system?.traits?.value?.includes('magical')

  // The early exit: nothing to revalue, so level and rarity are the stored ones
  // and only the price passes through computePrice.
  if ((!magical && !material && !grade.level) || item.system?.specific) {
    return { ...stored, price }
  }

  const worstRarity = [...runes.map(rarityOf), material ? rarityOf(material) : 'common'].reduce(
    (worst, next) => ((RARITY_ORDER[next] ?? 0) > (RARITY_ORDER[worst] ?? 0) ? next : worst),
    rarity ?? 'common'
  )
  return {
    level: Math.max(...runes.map((r) => r.l), material?.l ?? 0, grade.level, level ?? 0),
    rarity: worstRarity,
    price,
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
    rarity: item?.system?.traits?.rarity,
    price: item?.system?.price?.value,
    provisional: false
  }
  if (overlaidPaths.includes('system.price.value')) return stored
  return deriveItemValuation(item)
}
