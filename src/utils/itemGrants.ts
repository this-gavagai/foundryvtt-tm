// PF2e's item-grant graph, resolved client-side.
//
// When PF2e grants one item from another (a `GrantItem` rule element), it
// records the relationship on BOTH documents:
//
//   granter.flags.pf2e.itemGrants[<flag>] = { id, onDelete }  ← what happens to
//                                                                the GRANTER when
//                                                                the grantee goes
//   grantee.flags.pf2e.grantedBy          = { id, onDelete }  ← what happens to
//                                                                the GRANTEE when
//                                                                the granter goes
//
// That pair of flags is the whole configuration. Dying grants Unconscious,
// Unconscious grants Blinded and Prone; nothing in this file knows any of that.
// It just walks the edges the system already wrote.
//
// Why the app has to do this itself: PF2e implements the walk in
// `ItemPF2e.deleteDocuments`, a CLIENT-side static. The app deletes items by
// emitting `modifyDocument` straight at the server (api/documents.ts), which
// runs no client code at all — so the cascade never happened and removing Dying
// left Unconscious and Blinded stranded. Adding chained correctly only because
// creation goes through the GM's Foundry client (the ADD_COMPENDIUM_ITEM RPC),
// where PF2e's own `createDocuments` runs the grants.
//
// Two questions get answered here, both ports of pf2e 8.4.1:
//   removalLockedBy      — may this item be removed at all? (ConditionPF2e#isLocked)
//   resolveGrantDeletions — what else goes with it? (processGrantDeletions)
// Keep them faithful: divergence shows up as conditions the app and the GM's
// sheet disagree about.
//
// A third kind of grant is NOT represented here. `GrantItem` with
// `inMemoryOnly: true` — how Prone gives you Off-Guard — creates a condition
// that is never persisted and never leaves the client that built it, so it has
// no flags to walk and no document to delete. The app derives those separately
// (composables/character/characterItems.ts) and marks them locked outright.

export type GrantDeleteAction = 'cascade' | 'detach' | 'restrict'

export interface GrantEdge {
  id?: string | null
  onDelete?: GrantDeleteAction | null
}

// The wire shape this module needs. App actors carry plain JSON, not live
// PF2e documents, so everything is read off `flags` directly.
export interface GrantAwareItem {
  _id?: string | null
  name?: string | null
  type?: string | null
  flags?: {
    pf2e?: {
      grantedBy?: GrantEdge | null
      itemGrants?: Record<string, GrantEdge | null> | null
    } | null
  } | null
  // A condition can also name a parent OUTRIGHT, separately from the grant
  // flags: PF2e sets `references.parent` on an in-memory grant and on the
  // conditions an affliction's current stage imposes. Those aren't removable at
  // all — the parent owns them — which is a different statement from any
  // `onDelete` action.
  system?: { references?: { parent?: { id?: string | null } | null } | null } | null
}

// PF2e defaults a grantee's `onDelete` by item class: physical items detach
// (you keep the sword when the feat that gave it is retrained), everything else
// cascades. The system bakes this in during `_initialize`, so source data may or
// may not carry an explicit value — apply the same default either way.
const PHYSICAL_TYPES = new Set([
  'armor',
  'backpack',
  'book',
  'consumable',
  'equipment',
  'shield',
  'treasure',
  'weapon'
])

function grantedByAction(item: GrantAwareItem): GrantDeleteAction {
  return (
    item.flags?.pf2e?.grantedBy?.onDelete ??
    (PHYSICAL_TYPES.has(item.type ?? '') ? 'detach' : 'cascade')
  )
}

function grantEdges(item: GrantAwareItem): GrantEdge[] {
  return Object.values(item.flags?.pf2e?.itemGrants ?? {}).filter((e): e is GrantEdge => !!e)
}

// The name of whatever holds this item in place, or undefined when it can be
// removed on its own. This is a port of `ConditionPF2e#isLocked` — the same
// predicate PF2e's own sheet uses to decide whether to offer a remove button —
// widened to return WHO, so the app can say why instead of just refusing.
//
// Two ways to be held:
//   1. `system.references.parent` names an item still on the actor. This is what
//      an in-memory grant sets (Prone's Off-Guard), and what an affliction's
//      stage sets on the conditions it imposes. Nothing can remove these
//      directly; the parent owns them.
//   2. The granter marked its grant of this item `restrict` — Unconscious does
//      that to Blinded, so Blinded goes when Unconscious does and not before.
//
// A grant edge only counts while both halves agree: a `grantedBy` left pointing
// at an item that is already gone holds nothing, which is why both branches
// require the named item to still be present.
export function removalLockedBy(items: GrantAwareItem[], item: GrantAwareItem): string | undefined {
  const byId = (id: string | null | undefined) => (id ? items.find((i) => i._id === id) : undefined)
  const label = (i: GrantAwareItem) => i.name ?? i._id ?? 'another effect'

  const parent = byId(item.system?.references?.parent?.id)
  if (parent) return label(parent)

  const granter = byId(item.flags?.pf2e?.grantedBy?.id)
  if (!granter) return undefined
  const edge = grantEdges(granter).find((e) => e.id === item._id)
  return edge?.onDelete === 'restrict' ? label(granter) : undefined
}

export interface BlockedDeletion {
  /** Name of the item whose removal was refused. */
  item: string
  /** Name of the item doing the refusing. */
  preventer: string
}

// Thrown instead of writing when the grant graph refuses a removal. Carries the
// two item names so the UI can say WHY the button did nothing — PF2e's own
// sheet posts a notification here, and the app has no equivalent to fall back
// on. The names are Foundry's (already in the world's locale); the sentence
// around them is UI chrome and gets translated client-side.
export class GrantRestrictionError extends Error {
  constructor(readonly blocked: BlockedDeletion[]) {
    const [first] = blocked
    super(`${first?.item} can't be removed while ${first?.preventer} is applied`)
    this.name = 'GrantRestrictionError'
  }
}

export interface GrantDeletionPlan {
  /** Every item to delete: the requested ones plus everything they cascade to. */
  deleteIds: string[]
  /** Grantees that survive the deletion but must lose their dangling `grantedBy`. */
  detachIds: string[]
  /** Requested deletions PF2e refuses, and what refused them. */
  blocked: BlockedDeletion[]
}

/**
 * Expand a set of requested deletions across the grant graph.
 *
 * Removing Dying resolves to `{ deleteIds: [dying, unconscious, blinded],
 * detachIds: [prone] }` — Unconscious cascades off Dying, Blinded cascades off
 * Unconscious, and Prone detaches (you stay on the floor after you wake up).
 * Removing Unconscious on its own resolves to `{ blocked: [Unconscious ←
 * Dying] }`, because Dying's grant is marked `restrict`.
 */
export function resolveGrantDeletions(
  items: GrantAwareItem[],
  requestedIds: string[]
): GrantDeletionPlan {
  const byId = new Map(items.filter((i) => i._id).map((i) => [i._id as string, i]))
  const pending: GrantAwareItem[] = []
  for (const id of new Set(requestedIds)) {
    const item = byId.get(id)
    if (item && !pending.includes(item)) pending.push(item)
  }

  const detach = new Set<string>()
  const blocked: BlockedDeletion[] = []
  const label = (i: GrantAwareItem) => i.name ?? i._id ?? 'item'

  // Grantees of `item` that still point back at it — the other direction of an
  // `itemGrants` edge, ignoring entries whose target has already gone away.
  const granteesOf = (item: GrantAwareItem) =>
    grantEdges(item)
      .map((edge) => byId.get(edge.id ?? ''))
      .filter(
        (child): child is GrantAwareItem => !!child && child.flags?.pf2e?.grantedBy?.id === item._id
      )

  const process = (item: GrantAwareItem) => {
    const granter = byId.get(item.flags?.pf2e?.grantedBy?.id ?? '')
    // The granter's own `itemGrants` entry for this item says what removing
    // this item does TO THE GRANTER.
    const edgeFromGranter = granter ? grantEdges(granter).find((e) => e.id === item._id) : undefined
    const grantees = granteesOf(item)

    // `restrict` in either direction aborts this item's removal — unless the
    // restricting item is itself on the way out, in which case the restriction
    // is moot.
    if (granter && edgeFromGranter?.onDelete === 'restrict' && !pending.includes(granter)) {
      blocked.push({ item: label(item), preventer: label(granter) })
      pending.splice(pending.indexOf(item), 1)
      return
    }
    for (const child of grantees) {
      if (grantedByAction(child) === 'restrict' && !pending.includes(child)) {
        blocked.push({ item: label(item), preventer: label(child) })
        pending.splice(pending.indexOf(item), 1)
        return
      }
    }

    // Upward cascade: this item's existence is what justified the granter's.
    if (granter && edgeFromGranter?.onDelete === 'cascade' && !pending.includes(granter)) {
      pending.push(granter)
      process(granter)
    }
    // Downward cascade: grantees that only exist because this item does.
    for (const child of grantees) {
      if (grantedByAction(child) === 'cascade' && !pending.includes(child)) {
        pending.push(child)
        process(child)
      }
    }
    // Grantees that outlive their granter still have to stop claiming one.
    for (const child of grantees) {
      if (grantedByAction(child) === 'detach' && child._id) detach.add(child._id)
    }
  }

  // Snapshot: `process` appends cascaded items to `pending` and recurses into
  // them itself, and may splice a blocked item back out.
  for (const item of [...pending]) if (pending.includes(item)) process(item)

  const deleteIds = pending.map((i) => i._id).filter((id): id is string => !!id)
  // An item being deleted has no use for a detach.
  for (const id of deleteIds) detach.delete(id)
  return { deleteIds, detachIds: [...detach], blocked }
}
