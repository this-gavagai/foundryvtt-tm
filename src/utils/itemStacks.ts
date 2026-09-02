// PF2e's stackability rule, resolved client-side.
//
// Two items merge into one stack only if they are the same thing in every
// respect that a player could tell apart. "Same name and type" is not that
// test: a +1 striking longsword and a plain longsword are both named
// "Longsword" in an item's data, and folding one into the other would destroy
// the runes. What PF2e actually does (PhysicalItemPF2e#isStackableWith, pf2e
// 8.4.1) is compare the two items' entire `system` data structurally, after
// normalizing away the handful of fields that are allowed to differ — and then
// refuse outright in a few cases the comparison wouldn't catch.
//
// Why the app has to do this itself: `isStackableWith` is a method on a live
// PF2e document, and what the app holds is the JSON the Foundry side serialized
// with toObject() — the class methods the types promise don't exist at runtime
// (composables/character/helpers.ts). This is a port of the same rule, and it
// runs against the STORED documents rather than the sheet's own item model:
// that model keeps only the fields the sheet renders (defs/physicalItem.ts), so
// two items differing only in runes look identical through it. Comparing source
// data is also what PF2e compares — its own predicate reads `toObject().system`.
//
// Keep it faithful: divergence shows up as merges that quietly destroy an
// item's runes, or as two identical stacks the app refuses to combine.

import { isEqual } from 'lodash-es'
import { copperValue, type CoinCounts } from '@/utils/coins'

/**
 * An item as the wire payload carries one: identity fields plus `system` as
 * opaque data, since the comparison below reads the whole thing rather than any
 * particular field. Typed structurally so both stored documents and plain
 * fixtures satisfy it.
 */
export interface StackableItem {
  _id?: string | null | undefined
  name?: string | null | undefined
  type?: string | null | undefined
  system?: unknown
}

// The parts of `system` the guards read by name. Everything else reaches the
// structural comparison untouched.
interface StackableSystem {
  quantity?: number | null
  equipped?: {
    carryType?: string | null
    handsHeld?: number | null
    inSlot?: boolean | null
  } | null
  containerId?: string | null
  identification?: { status?: string | null } | null
  uses?: { value?: number | null; max?: number | null } | null
  category?: string | null
  price?: { value?: Partial<CoinCounts> | null } | null
}

const sys = (item: StackableItem): StackableSystem => (item.system ?? {}) as StackableSystem

// Fields two members of the same stack are allowed to differ in. PF2e copies
// each one from the second item onto the first before comparing; dropping them
// from both is the same comparison, and says more plainly that they don't count.
const IGNORED_FIELDS = [
  'quantity',
  'equipped',
  'containerId',
  '_migration',
  'identification',
  'publication'
] as const

/** How many an item's stack holds — 0 when the field is missing. */
export const stackQuantity = (item: StackableItem): number => sys(item).quantity ?? 0

const isIdentified = (item: StackableItem) => sys(item).identification?.status === 'identified'

// PF2e counts an item as held only when hands are actually on it — carryType
// alone isn't enough, since `handsHeld` defaults to 1 for a held item.
function handsHeld(item: StackableItem): number {
  const equipped = sys(item).equipped
  return equipped?.carryType === 'held' ? (equipped.handsHeld ?? 1) : 0
}

const isHeld = (item: StackableItem) => handsHeld(item) > 0

// Armor and shields refuse to stack while either copy is equipped
// (ArmorPF2e/ShieldPF2e#isStackableWith). PF2e decides "equipped" from the
// item's usage against its carry state, and for these two types usage is fixed:
// armor's is always `wornarmor` (worn, in its slot) and a shield's is held — so
// both cases reduce to the carry state the sheet already shows.
function isEquippedForStacking(item: StackableItem): boolean {
  const equipped = sys(item).equipped
  if (!equipped || equipped.carryType === 'dropped') return false
  if (item.type === 'armor') return equipped.carryType === 'worn' && !!equipped.inSlot
  return isHeld(item)
}

// `system`, ready to compare: the allowed differences dropped, and price
// flattened to copper so 1 gp and 100 cp aren't read as different prices.
function comparableSystem(item: StackableItem): Record<string, unknown> {
  const system = { ...((item.system ?? {}) as Record<string, unknown>) }
  for (const field of IGNORED_FIELDS) delete system[field]
  system.price = {
    ...(sys(item).price ?? {}),
    value: { cp: copperValue(sys(item).price?.value ?? {}) }
  }
  return system
}

/**
 * Whether `source` may be folded into `destination` — the direction PF2e's own
 * `stackWith` uses, where the source is consumed and the destination keeps the
 * total. The asymmetry in the guards below is PF2e's, kept as written.
 *
 * `parentItem` is absent from the port: a subitem (an attached shield boss) is
 * never a stack the sheet offers, so the case can't arise here.
 */
export function stackableWith(source: StackableItem, destination: StackableItem): boolean {
  const from = sys(source)
  const to = sys(destination)

  // Same thing, two documents.
  if (!source._id || !destination._id || source._id === destination._id) return false
  if (source.type !== destination.type) return false
  if (source.name !== destination.name) return false
  if (isIdentified(source) !== isIdentified(destination)) return false

  // Containers never stack, however identical: ContainerPF2e#isStackableWith is
  // a flat `false`, because each one holds its own contents.
  if (source.type === 'backpack' || destination.type === 'backpack') return false

  // Partly spent charges stay their own item.
  if (destination.type === 'ammo' || destination.type === 'consumable') {
    if ((to.uses?.value ?? 0) < (to.uses?.max ?? 0)) return false
  }

  // A credstick carries a balance, so two of them are never the same stack.
  if (destination.type === 'treasure' && to.category === 'credstick') return false

  if (
    (source.type === 'armor' || source.type === 'shield') &&
    (isEquippedForStacking(source) || isEquippedForStacking(destination))
  ) {
    return false
  }

  // Held-ness has to match, and two stacks that are both in hand don't merge
  // unless one of them is empty — hands are tracked per item, and PF2e won't
  // silently decide how many are on the survivor.
  if (
    !from.containerId &&
    !(
      isHeld(source) === isHeld(destination) &&
      (!isHeld(source) || (from.quantity ?? 0) === 0 || (to.quantity ?? 0) === 0)
    )
  ) {
    return false
  }

  return isEqual(comparableSystem(source), comparableSystem(destination))
}

/**
 * The ids of every item in `items` that could be folded into `destination`.
 *
 * Unlike PF2e's own automatic lookup (ActorInventory#findStackableItem), which
 * only considers items in the same container, this doesn't care where a
 * candidate is stowed: a player merging two stacks by hand is telling us they
 * want them together, and the survivor keeps its own container. The predicate
 * normalizes `containerId` away for exactly that reason.
 */
export function stackCandidateIds(
  items: readonly StackableItem[] | undefined,
  destination: StackableItem
): string[] {
  return (items ?? []).filter((item) => stackableWith(item, destination)).map((item) => item._id!)
}
