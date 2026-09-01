// Coins are the one part of an inventory that isn't really a list of things.
// A player never wants to read "Gold Pieces (x143)" among their daggers and
// potions — they want a purse: four numbers that go up and down constantly.
// This module holds the arithmetic behind that view; the writes live in
// useCoins.ts and the interface in EquipmentCoins.vue.

export const COIN_DENOMINATIONS = ['pp', 'gp', 'sp', 'cp'] as const
export type Denomination = (typeof COIN_DENOMINATIONS)[number]
export type CoinCounts = Record<Denomination, number>

/** Copper is PF2e's atomic unit: 10 cp = 1 sp, 10 sp = 1 gp, 10 gp = 1 pp. */
export const COPPER_PER: CoinCounts = { pp: 1000, gp: 100, sp: 10, cp: 1 }

// PF2e's own coin items (ActorInventory#addCurrency creates from these). Needed
// only when a character holds no stack of a denomination at all — there is then
// no item to bump, so one has to be created.
export const COIN_UUIDS: Record<Denomination, string> = {
  pp: 'Compendium.pf2e.equipment-srd.Item.JuNPeK5Qm1w6wpb4',
  gp: 'Compendium.pf2e.equipment-srd.Item.B6B7tBWJSqOBz5zz',
  sp: 'Compendium.pf2e.equipment-srd.Item.5Ew82vBF9YfaiY9f',
  cp: 'Compendium.pf2e.equipment-srd.Item.lzJ8AVhRcbFul5fh'
}

const COIN_SLUGS: Record<Denomination, string> = {
  pp: 'platinum-pieces',
  gp: 'gold-pieces',
  sp: 'silver-pieces',
  cp: 'copper-pieces'
}

export const emptyCounts = (): CoinCounts => ({ pp: 0, gp: 0, sp: 0, cp: 0 })

/**
 * The little of an inventory item these readers actually look at. Typed
 * structurally rather than as InventoryItem so the coin rules can be exercised
 * against plain wire JSON — which is what an item is by the time it reaches the
 * app anyway — and so coinStacks() hands back whatever item type it was given,
 * write methods and all.
 */
export interface CoinLike {
  type?: string | undefined
  system?: {
    slug?: string | undefined
    stackGroup?: string | null | undefined
    quantity?: number | undefined
    price?: { value?: Partial<Record<Denomination, number | undefined>> | undefined } | undefined
  }
}

/**
 * A coin stack the app can also write to: the readable shape above plus the
 * two mutators characterItems binds onto every inventory item.
 */
export interface CoinStack extends CoinLike {
  changeQty?: (newTotal: number) => unknown
  delete?: () => unknown
}

/**
 * The denomination of a coin stack, or undefined for anything that isn't one.
 *
 * PF2e marks coinage with `system.category === 'coin'` and derives the
 * denomination from whichever of the price fields is set (a coin's price is
 * exactly one of 1pp/1gp/1sp/1cp). The app's wire shape carries neither
 * `category` nor a live TreasurePF2e, so the test here is the stack group —
 * already what the equipment list uses to compute coin Bulk — plus the same
 * price read, falling back on the slug for a stack whose price didn't survive.
 */
export function coinDenomination(item: CoinLike | undefined): Denomination | undefined {
  if (!item || item.type !== 'treasure' || item.system?.stackGroup !== 'coins') return undefined
  const price = item.system?.price?.value
  const priced = COIN_DENOMINATIONS.filter((d) => price?.[d])
  if (priced.length === 1) return priced[0]
  return COIN_DENOMINATIONS.find((d) => item.system?.slug === COIN_SLUGS[d])
}

export function isCoin(item: CoinLike | undefined): boolean {
  return coinDenomination(item) !== undefined
}

/**
 * The one stack per denomination in an inventory. PF2e keeps coinage in a
 * single stack each, but a stray import can leave two — take the largest so the
 * panel edits the stack the player thinks of as their purse.
 */
export function coinStacks<T extends CoinLike>(
  inventory: T[] | undefined
): Partial<Record<Denomination, T>> {
  const stacks: Partial<Record<Denomination, T>> = {}
  for (const item of inventory ?? []) {
    const denomination = coinDenomination(item)
    if (!denomination) continue
    const held = stacks[denomination]
    if (!held || (item.system?.quantity ?? 0) > (held.system?.quantity ?? 0)) {
      stacks[denomination] = item
    }
  }
  return stacks
}

export function coinCounts(inventory: CoinLike[] | undefined): CoinCounts {
  const counts = emptyCounts()
  const stacks = coinStacks(inventory)
  for (const denomination of COIN_DENOMINATIONS) {
    counts[denomination] = stacks[denomination]?.system?.quantity ?? 0
  }
  return counts
}

export function copperValue(counts: Partial<CoinCounts>): number {
  return COIN_DENOMINATIONS.reduce((sum, d) => sum + (counts[d] ?? 0) * COPPER_PER[d], 0)
}

export function addCounts(a: CoinCounts, b: Partial<CoinCounts>): CoinCounts {
  const sum = emptyCounts()
  for (const d of COIN_DENOMINATIONS) sum[d] = a[d] + (b[d] ?? 0)
  return sum
}

export function hasChange(deltas: Partial<CoinCounts>): boolean {
  return COIN_DENOMINATIONS.some((d) => (deltas[d] ?? 0) !== 0)
}

/**
 * A purse total in gold, the unit players quote prices in. Trailing sub-gold
 * digits only appear when there are any, so a round purse reads "143 gp"
 * rather than "143.00 gp".
 */
export function formatGold(copper: number): string {
  const gold = copper / COPPER_PER.gp
  const text = Number.isInteger(gold) ? String(gold) : gold.toFixed(2)
  return `${Number(text).toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(gold) ? 0 : 2,
    maximumFractionDigits: 2
  })} gp`
}

/** A change in a purse's worth, signed: "+13.90 gp", "−2 gp". */
export function signedGold(copper: number): string {
  return `${copper > 0 ? '+' : '−'}${formatGold(Math.abs(copper))}`
}

/**
 * Source data for a coin stack, for the case where a character holds none of a
 * denomination and PF2e's own item can't be fetched from the compendium. Only
 * the fields that make it read and stack correctly are set; PF2e fills the rest
 * on creation.
 */
export function fallbackCoinSource(denomination: Denomination, quantity: number) {
  const names: Record<Denomination, string> = {
    pp: 'Platinum Pieces',
    gp: 'Gold Pieces',
    sp: 'Silver Pieces',
    cp: 'Copper Pieces'
  }
  return {
    name: names[denomination],
    type: 'treasure',
    img: `systems/pf2e/icons/equipment/treasure/currency/${COIN_SLUGS[denomination]}.webp`,
    system: {
      slug: COIN_SLUGS[denomination],
      category: 'coin',
      stackGroup: 'coins',
      quantity,
      size: 'med',
      bulk: { value: 0 },
      price: { value: { [denomination]: 1 } },
      description: { value: '' },
      traits: { value: [], rarity: 'common' }
    }
  }
}
