import type { AbstractEffectPF2e } from '@7h3laughingman/pf2e-types'
import type { Item, ItemSystem } from './item'
import { makeItem } from './item'

export interface Effect extends Item {
  system: EffectSystem
}

// `duration` and `start` are both SOURCE data — EffectPF2e#_preCreate stamps
// `start` with the world time the effect was created at, writing it into
// `_source`, so both survive the toObject() the wire payload is built from and
// need no overlay. What is NOT here is `system.expired`, which PF2e derives in
// prepareBaseData and the payload therefore drops; the app answers the same
// question from the clock instead (utils/effectDuration.ts).
//
// Both are OPTIONAL, and that is a statement about the panel rather than about
// the schema: the effects list is a union of three things (see the effects
// computed in characterItems.ts). Only the stored documents come through here.
// Beside them sit conditions PF2e grants in memory, which the app synthesises
// itself and which have no document to have a duration, and divine
// intercession feats, which are boons and curses rather than effects. Requiring
// a duration here made both of those a compile error, which was the type system
// pointing out that "an effect row" and "an effect" are not the same set.
export interface EffectSystem extends ItemSystem {
  duration?: {
    value: number | undefined
    unit: string | undefined
    expiry: string | undefined
  }
  start?: { value: number | undefined; initiative: number | undefined }
}

export function makeEffect(root: AbstractEffectPF2e): Effect {
  const base = makeItem(root)!
  const duration = root.system.duration
  const start = root.system.start
  return {
    ...base,
    system: {
      ...base.system,
      duration: {
        value: duration?.value,
        unit: duration?.unit,
        expiry: duration?.expiry ?? undefined
      },
      // Left undefined rather than filled in: an effect with no start stamp is
      // one that never began against a clock, which is a different thing from
      // one that began at time zero.
      start: start ? { value: start.value, initiative: start.initiative ?? undefined } : undefined
    }
  } as Effect
}
