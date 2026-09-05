// PF2e's Bulk arithmetic and inventory total, reproduced from source data.
//
// The one Tier-2 figure that needs no rule elements to be right. Bulk is a pure
// function of what the actor is carrying: item Bulk values, quantities, stack
// sizes, item and actor size, and container capacity — all of it stored, none of
// it synthesised. That is what separates it from AC or a skill total, where the
// number is the OUTPUT of the synthetics pipeline rather than a sum over items.
//
// Faithful to `InventoryBulk` and `Bulk` in pf2e 8.4.1 rather than approximated:
// the encumbrance thresholds, the light-unit rounding, the stack grouping, the
// size conversion ladder and the container rules are each PF2e's, and the tests
// pin them individually.
//
// TWO bounds, both narrow and both rule-element shaped:
//
//   * `maxAddend` / `encumberedAfterAddend`. PF2e exposes these as writable
//     fields that an ActiveEffectLike rule element can raise (a Bag of Holding
//     feat, Hefty Hauler). Nothing in source says so, so a character with one
//     reads five Bulk light here. Callers pass them in when a payload has
//     supplied them.
//   * Item Bulk altered by an ItemAlteration. Rare, and it moves `bulk.value`
//     on the item rather than anything here.

// PF2e's ladder, with `sm` folded into `med` — a small creature carries what a
// medium one does. Index distance is what the conversion doubles or halves over.
const SIZE_LADDER = ['tiny', 'med', 'lg', 'huge', 'grg'] as const
const normalizeSize = (size: string | undefined) => (size === 'sm' ? 'med' : (size ?? 'med'))

// A Bulk quantity, in whole Bulk plus tenths ("light").
//
// Held as a single float rounded to one decimal, exactly as PF2e does, because
// that rounding is load-bearing: ten light items summed by repeated addition
// land on 0.9999… and would otherwise read as 9 light rather than 1 Bulk.
export class Bulk {
  readonly value: number

  constructor(value = 0) {
    this.value = Math.round(Math.max(value, 0) * 10) / 10
  }

  get normal(): number {
    return Math.floor(this.value)
  }

  get light(): number {
    return Math.round((this.value - this.normal) * 10)
  }

  get isNegligible(): boolean {
    return this.value === 0
  }

  get isLight(): boolean {
    return this.value > 0 && this.value < 1
  }

  toLightUnits(): number {
    return this.normal * 10 + this.light
  }

  plus(other: Bulk | number): Bulk {
    return new Bulk(this.value + (typeof other === 'number' ? other : other.value))
  }

  minus(other: Bulk | number): Bulk {
    return new Bulk(this.value - (typeof other === 'number' ? other : other.value))
  }

  times(factor: number): Bulk {
    return new Bulk(Math.round(this.value * factor * 10) / 10)
  }

  // Negligible becomes light, light becomes 1 Bulk, everything else doubles —
  // PF2e's rule, not plain multiplication, which is why this is not `times(2)`.
  double(): Bulk {
    return this.isNegligible ? new Bulk(0.1) : this.isLight ? new Bulk(1) : this.times(2)
  }

  // Carried by a creature of a different size than the item was made for. Each
  // step up the ladder doubles; each step down collapses to light, then to
  // negligible, then halves with a light floor.
  convertToSize(itemSize: string | undefined, actorSize: string | undefined): Bulk {
    const from = SIZE_LADDER.indexOf(normalizeSize(itemSize) as (typeof SIZE_LADDER)[number])
    const to = SIZE_LADDER.indexOf(normalizeSize(actorSize) as (typeof SIZE_LADDER)[number])
    if (from < 0 || to < 0 || from === to) return new Bulk(this.value)
    if (from > to) {
      let heavier = new Bulk(this.value)
      for (let step = 0; step < from - to; step++) heavier = heavier.double()
      return heavier
    }
    let lighter = new Bulk(this.value)
    for (let step = 0; step < to - from; step++) {
      lighter =
        lighter.value <= 0.1
          ? new Bulk()
          : lighter.value <= 1
            ? new Bulk(0.1)
            : new Bulk(Math.max(0.1, Math.floor(0.5 * lighter.value)))
    }
    return lighter
  }
}

// The item fields the sum reads. Every one is stored source data.
export interface BulkItem {
  _id?: string | null
  type?: string
  system?: {
    bulk?: { value?: number; per?: number; capacity?: number; ignored?: number }
    baseItem?: string | null
    quantity?: number
    containerId?: string | null
    size?: string
    stowing?: boolean
    traits?: { value?: string[] }
    subitems?: BulkItem[]
  }
}

const bulkPer = (item: BulkItem) => item.system?.bulk?.per || 1
const isContainer = (item: BulkItem) => item.type === 'backpack'
const contentsOf = (item: BulkItem, all: readonly BulkItem[]) =>
  all.filter((candidate) => candidate.system?.containerId === item._id)

// One item's own Bulk: its stored value, size-converted, times the number of
// whole stacks its quantity makes up. `per` is the quantity a Bulk value is
// quoted FOR — 10 for arrows — so nine arrows weigh nothing.
function itemBulk(item: BulkItem, actorSize: string | undefined): Bulk {
  const stacks = Math.floor((item.system?.quantity ?? 0) / bulkPer(item))
  return new Bulk(item.system?.bulk?.value ?? 0)
    .convertToSize(item.system?.size, actorSize)
    .times(stacks)
}

// A container that does not stow (a sheath, a quiver) is not a thing you carry
// with things inside it — PF2e replaces it with its contents and counts those
// against the wearer directly.
function flattenNonStowing(items: readonly BulkItem[], all: readonly BulkItem[]): BulkItem[] {
  return items.flatMap((item) =>
    isContainer(item) && !item.system?.stowing
      ? flattenNonStowing(contentsOf(item, all), all)
      : [item]
  )
}

export interface ContainerCapacityResult {
  value: Bulk
  max: Bulk
  percentFull: number
  ignored: Bulk
}

// What a container is holding, how much it can hold, and how much Bulk it is
// negating for its wearer right now.
export function containerCapacity(
  container: BulkItem,
  all: readonly BulkItem[],
  actorSize: string | undefined
): ContainerCapacityResult {
  const value = computeTotalBulk(contentsOf(container, all), all, actorSize)
  const max = new Bulk(container.system?.bulk?.capacity ?? 0)
  // Light-unit based up to 100%, whole-Bulk based beyond it — PF2e's own
  // two-regime percentage, not a single ratio.
  const asLight = max.toLightUnits() > 0 ? (value.toLightUnits() / max.toLightUnits()) * 100 : 0
  const rough = Math.floor(asLight)
  const percentFull =
    rough > 100 ? Math.floor(max.normal > 0 ? (value.normal / max.normal) * 100 : 100) : rough

  // The negation lapses over capacity, and for an extradimensional container
  // stowed inside another one.
  const overCapacity = percentFull > 100
  const nested =
    (container.system?.traits?.value ?? []).includes('extradimensional') &&
    !!container.system?.containerId
  const ignored =
    overCapacity || nested ? new Bulk() : new Bulk(container.system?.bulk?.ignored ?? 0)
  return { value, max, percentFull, ignored }
}

// A container weighs itself plus its contents, less what it negates.
function containerBulk(
  container: BulkItem,
  all: readonly BulkItem[],
  actorSize: string | undefined
): Bulk {
  const { value, ignored } = containerCapacity(container, all, actorSize)
  return itemBulk(container, actorSize).plus(value.minus(ignored))
}

// PF2e's `InventoryBulk.computeTotalBulk`.
//
// The split is not decoration. Containers and single-stack base items are summed
// INDIVIDUALLY (each carrying its own subitems); everything else is GROUPED by
// base item, stack size and unit Bulk, and the group's combined quantity is what
// gets floor-divided. That is what makes two quivers of five arrows weigh a light
// between them while each on its own reads as nothing.
export function computeTotalBulk(
  items: readonly BulkItem[],
  all: readonly BulkItem[],
  actorSize: string | undefined
): Bulk {
  const flattened = flattenNonStowing(items, all)
  const individual = flattened.filter(
    (item) => isContainer(item) || (bulkPer(item) === 1 && !!item.system?.baseItem)
  )
  const individualIds = new Set(individual.map((item) => item._id))
  const grouped = flattened.filter((item) => !individualIds.has(item._id))

  const withSubitems = (item: BulkItem) =>
    (item.system?.subitems ?? []).reduce(
      (sum, sub) => sum.plus(itemBulk(sub, actorSize)),
      isContainer(item) ? containerBulk(item, all, actorSize) : itemBulk(item, actorSize)
    )

  const individualTotal = individual.reduce((sum, item) => sum.plus(withSubitems(item)), new Bulk())

  const groups = new Map<string, { unit: Bulk; per: number; quantity: number }>()
  for (const item of grouped) {
    const unit = new Bulk(item.system?.bulk?.value ?? 0).convertToSize(item.system?.size, actorSize)
    const per = bulkPer(item)
    const key = `${item.system?.baseItem ?? null}-${per}-${unit.toLightUnits()}`
    const entry = groups.get(key) ?? { unit, per, quantity: 0 }
    entry.quantity += item.system?.quantity ?? 0
    groups.set(key, entry)
  }
  const groupedTotal = [...groups.values()].reduce(
    (sum, { unit, per, quantity }) => sum.plus(unit.times(Math.floor(quantity / per))),
    new Bulk()
  )

  return individualTotal.plus(groupedTotal)
}

export interface InventoryBulk {
  value: Bulk
  max: number
  encumberedAfter: number
  isEncumbered: boolean
  isOverMax: boolean
}

// The actor's Bulk readout. Only items NOT inside a container are counted at the
// top level — a container reports its contents as part of its own Bulk.
export function inventoryBulk(
  items: readonly BulkItem[],
  strengthModifier: number,
  actorSize: string | undefined,
  addends: { max?: number; encumberedAfter?: number } = {}
): InventoryBulk {
  const carried = items.filter((item) => !item.system?.containerId)
  const value = computeTotalBulk(carried, items, actorSize)
  // 10 + Str for the carrying maximum, 5 + Str before encumbrance. Both floored,
  // because a rule element addend may be fractional.
  const max = Math.floor(strengthModifier + 10 + (addends.max ?? 0))
  const encumberedAfter = Math.floor(strengthModifier + 5 + (addends.encumberedAfter ?? 0))
  return {
    value,
    max,
    encumberedAfter,
    isEncumbered: value.normal > encumberedAfter,
    isOverMax: value.normal > max
  }
}
