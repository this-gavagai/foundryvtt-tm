// Turning an item the app already holds into the payload for a create.
//
// The app clones an existing item in two places — splitting a stack, and moving
// one between a character and the party stash — and writes the clone straight at
// the server over modifyDocument, with no Foundry client anywhere to shape it.
// What has to be stripped first is not obvious, and getting it wrong is silent:
// Foundry's DataModel fills whatever is missing with schema defaults, so a
// create built from the wrong object SUCCEEDS and produces a plausible-looking
// item that has quietly lost its rule elements, its ChoiceSet answers, a
// shield's reinforcing rune, or the spell a wand casts — and whose base data
// has reverted to the schema's (a 1d8 longsword becomes the default 1d6, and a
// martial weapon becomes simple).
//
// Two properties of the app's item data make it wrong, and this module exists
// for both:
//
//   1. The sheet's item model is a PROJECTION (composables/character/defs/*),
//      keeping only the fields the sheet renders. It resembles a document
//      closely enough to type-check as one — _id, name, type, system — so
//      handing it to a clone compiles and drops everything else. Hence
//      StoredItem below, which requires a field the projection hasn't got.
//
//   2. The wire payload is source data with PREPARED values overlaid on top, so
//      the sheet can show a rune-adjusted level or a modular weapon's current
//      damage type rather than what is stored (see the overlay recorder in
//      foundry/handlers/characterDetails.ts). Those values belong to the
//      display, not to the item: persisted as source they change what the item
//      IS. The Foundry side records what each overlay displaced; this module
//      puts it back.
//
// A COMPENDIUM document needs none of this. It never passed through the overlay
// step, and its level and price ARE its source data — a helper that removed
// them would destroy real values. api/compendium.ts's getCompendiumSource is
// that path; it drops `_id` alone, and must not be routed through here.
//
// Both ends of the overlay contract live in this file on purpose. The recorder
// runs on the Foundry side and the restore runs in the app, and the reason
// finding 2 existed at all is that the two halves were separated: six overlays
// were added for display and nobody revisited the sites that clone an item.

import { MODULE_ID } from '@/api/protocol'

// Where the flag goes: flags.tablemate.derived on the item itself.
export const DERIVED_FLAG_KEY = 'derived'

/**
 * One prepared value overlaid onto source, and whatever source held there.
 *
 * `had: false` is a real case rather than a null-ish stand-in — several
 * overlays fill in a field PF2e derives and never stores (an innate spell's
 * `location.uses`, an unspent action's `frequency.value`), so restoring means
 * REMOVING the key, not writing a null into it.
 */
export type DisplacedValue =
  | { path: string; had: true; value: unknown }
  | { path: string; had: false }

/**
 * An item as the wire payload carries one: whole source data, opaque here
 * because a create needs all of it rather than any particular field.
 *
 * `flags` is required, and that is the point. Every item on the wire carries it
 * (toObject() includes it); the sheet's projection carries none — makeItem
 * hoists `itemGrants`/`grantedBy` to the top level and drops the rest — so
 * demanding it turns "cloned the view model" from a silent, lossy create into a
 * compile error. See utils/itemStacks.ts, which draws the same distinction for
 * the same reason; its StackableItem is deliberately looser, since a structural
 * comparison can run against either shape.
 */
export interface StoredItem {
  // Required and nullable to match api/internal's DocumentData, so the one cast
  // a caller makes (`asDocumentArray(...) as StoredItem[]`) stays a single `as`.
  _id: string | null
  name?: string | null
  type?: string | null
  img?: string | null
  system?: Record<string, unknown>
  flags: Record<string, unknown>
  [key: string]: unknown
}

type Mutable = Record<string, unknown>

function isObject(value: unknown): value is Mutable {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

// Dot-path access, shared by the recorder and the restore so both agree on what
// a path means. Deliberately not Foundry's getProperty/setProperty: this module
// is imported by the app, where no `foundry` global exists.
function readPath(root: Mutable, path: string): DisplacedValue {
  const parts = path.split('.')
  const leaf = parts.pop()!
  let node: unknown = root
  for (const part of parts) {
    if (!isObject(node)) return { path, had: false }
    node = node[part]
  }
  if (!isObject(node) || !Object.prototype.hasOwnProperty.call(node, leaf)) {
    return { path, had: false }
  }
  return { path, had: true, value: node[leaf] }
}

function writePath(root: Mutable, path: string, value: unknown): void {
  const parts = path.split('.')
  const leaf = parts.pop()!
  let node: Mutable = root
  for (const part of parts) {
    const next = node[part]
    if (!isObject(next)) node[part] = {}
    node = node[part] as Mutable
  }
  node[leaf] = value
}

function clearPath(root: Mutable, path: string): void {
  const parts = path.split('.')
  const leaf = parts.pop()!
  let node: unknown = root
  for (const part of parts) {
    if (!isObject(node)) return
    node = node[part]
  }
  if (isObject(node)) delete node[leaf]
}

// Cheap structural comparison, so an overlay that changed nothing records
// nothing. Most items are unaffected by most overlays — a plain longsword's
// prepared level and price are its source level and price — and skipping those
// keeps the flag off the great majority of items rather than adding a few
// hundred bytes to every one of them.
//
// JSON, not a deep-equal import: these values are small plain data (a number, a
// coin object, a short string), and the module bundle is better off without the
// dependency. A false "changed" from key ordering only costs one recorded
// entry, and restores to the same value it displaced.
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

/**
 * Overlay a prepared value onto an item's source payload, remembering what it
 * displaced. Called on the FOUNDRY side, once per overlaid path.
 *
 * Records nothing when the prepared value already equals the stored one, which
 * is the common case.
 */
export function recordOverlay(
  item: Mutable,
  displaced: DisplacedValue[],
  path: string,
  value: unknown
): void {
  const before = readPath(item, path)
  if (before.had && sameValue(before.value, value)) return
  displaced.push(before)
  writePath(item, path, value)
}

/**
 * Attach the recorded overlays to the item, so the app can undo them before
 * cloning it. A no-op when nothing was displaced.
 */
export function attachDisplaced(item: Mutable, displaced: DisplacedValue[]): void {
  if (!displaced.length) return
  writePath(item, `flags.${MODULE_ID}.${DERIVED_FLAG_KEY}`, displaced)
}

/** The overlays recorded on an item, or an empty list. */
export function displacedOverlays(item: StoredItem): DisplacedValue[] {
  const scope = item.flags?.[MODULE_ID]
  const recorded = isObject(scope) ? scope[DERIVED_FLAG_KEY] : undefined
  return Array.isArray(recorded) ? (recorded as DisplacedValue[]) : []
}

export interface EmbeddedSourceOptions {
  /** Quantity for the new stack. Omit to keep the original's. */
  quantity?: number
  /**
   * Set when the clone lands on a DIFFERENT actor. The container it was stowed
   * in does not exist there, so the reference is dropped rather than carried
   * over as a dangling containerId.
   */
  toActor?: boolean
}

/**
 * The source data for creating a copy of an item the app already holds.
 *
 * Everything not named below is kept deliberately — including `_stats`, whose
 * `compendiumSource` is what identifies the item's origin pack. A split or a
 * transfer genuinely IS the same item, so it should keep saying so.
 */
export function sourceFromEmbedded(
  stored: StoredItem,
  opts: EmbeddedSourceOptions = {}
): Record<string, unknown> {
  // A JSON round-trip, not structuredClone: `stored` is an item off the
  // reactive actor, so it reaches here wrapped in a Vue proxy, and
  // structuredClone throws DataCloneError on a Proxy. The round-trip also
  // strips the reactivity itself, which is what a create payload wants. Safe
  // because these items ARE JSON by construction — they arrived over a socket.
  const source = JSON.parse(JSON.stringify(stored)) as Mutable

  // Undo the display overlays FIRST, so nothing below reads a prepared value.
  for (const entry of displacedOverlays(stored)) {
    if (entry.had) writePath(source, entry.path, entry.value)
    else clearPath(source, entry.path)
  }
  // The record itself is display bookkeeping and has no business being stored.
  clearPath(source, `flags.${MODULE_ID}.${DERIVED_FLAG_KEY}`)
  const scope = (source.flags as Mutable | undefined)?.[MODULE_ID]
  if (isObject(scope) && !Object.keys(scope).length) {
    delete (source.flags as Mutable)[MODULE_ID]
  }

  // A create must not name an id.
  delete source._id

  // Attached items (a shield boss, loaded ammunition) are documents in their own
  // right, so carrying them along would conjure a second one out of a copy. The
  // copy comes out bare; the attachments stay with the original.
  clearPath(source, 'system.subitems')

  // A grant link belongs to the item that was granted, not to a copy of it.
  // Left in place, the copy answers to a feat that never granted it — and
  // utils/itemGrants reads that as a reason the copy cannot be removed.
  clearPath(source, `flags.pf2e.grantedBy`)
  clearPath(source, `flags.pf2e.itemGrants`)

  if (opts.toActor) clearPath(source, 'system.containerId')
  if (opts.quantity !== undefined) writePath(source, 'system.quantity', opts.quantity)

  return source
}
