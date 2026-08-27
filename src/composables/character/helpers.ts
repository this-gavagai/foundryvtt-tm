import type { ActorPF2e, ItemInstances, ItemType } from '@7h3laughingman/pf2e-types'
import type { TablemateActor } from '@/types/character-types'
import type { ComputedRef, WritableComputedRef } from 'vue'

export type Field<T> = ComputedRef<T | undefined>
export type WritableField<T> = WritableComputedRef<T | undefined>
export type Maybe<T> = T | undefined

// An actor's items of one or more given types, typed as PF2e's own item classes.
//
// Two things make this a helper rather than a filter at each call site.
//
// First, PF2e's `isOfType` guard is not available here. The app never holds live
// documents: the Foundry side serializes actors with toObject() and they arrive
// over the socket as plain JSON, so the methods PF2e's classes declare do not
// exist at runtime. `type` is the only discriminant these objects carry, and it
// is the one this checks. (The actor types say CharacterPF2e & co. because the
// FIELDS line up; the methods do not, and reaching for one fails at runtime, not
// at compile time.)
//
// Second, the items are collected as `{ type?: string }` before the assertion
// rather than as PF2e items. Those carry the actor they hang off as a type
// parameter, and the Tablemate actor types intersect TablemateActorExtras —
// which reaches back into CharacterPF2e['inventory'] — into that actor, so
// relating one to anything else re-expands the intersection until TypeScript
// gives up with TS2589. Reading only the discriminant sidesteps that, and keeps
// the assertion a checked `as` instead of a trip through `unknown`.
//
// What it buys: the runtime test and the returned type are decided together, in
// one place, off PF2e's own ItemInstances map — so a call site gets
// SpellcastingEntryPF2e[] from asking for 'spellcastingEntry', with no assertion
// of its own, and an item type PF2e renames stops compiling.
export function itemsOfType<T extends ItemType>(
  actor: TablemateActor | undefined,
  ...types: T[]
): Array<ItemInstances<ActorPF2e | null>[T]> {
  const wanted = new Set<string>(types)
  const items: Array<{ type?: string }> = actor?.items ? [...actor.items] : []
  return items.filter((i) => wanted.has(i.type ?? '')) as Array<ItemInstances<ActorPF2e | null>[T]>
}

// Narrow one already-fetched item to a single type.
//
// The companion to itemsOfType, for a list fetched as more than one type and
// then split (effects vs. conditions). PF2e does not make its item classes a
// discriminated union — `type` is declared `string` on all of them, which is
// why `isOfType` exists as a method — so the split has to be stated as a
// predicate. This one is the honest version of that statement: its body runs the
// same `type` comparison the wire data supports, and the type it asserts comes
// from PF2e's ItemInstances map rather than being named by hand at the call site.
export function isItemOfType<T extends ItemType>(
  item: { type?: string },
  type: T
): item is ItemInstances<ActorPF2e | null>[T] {
  return item.type === type
}
