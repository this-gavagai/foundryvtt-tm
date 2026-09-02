import type { CheckRollHandler } from './types'

// The recovery check a dying creature attempts at the start of its turn.
//
// PF2e owns the whole thing on `CreaturePF2e#rollRecovery`: it builds a
// flat-check statistic against `recoveryDC + dying.value` — so Toughness and
// anything else that alters `recoveryDC` is already baked into the prepared
// attribute — and attaches the four outcome notes ("you lose the dying
// condition", "your dying value increases by 1", …) to the card. Calling it is
// strictly better than assembling an equivalent check here, which would have to
// re-derive the DC and re-localize the notes.
//
// Deliberately does NOT adjust the dying value, grant Wounded, or mark anyone
// dead. Neither does PF2e: the card states the outcome and the consequences are
// applied separately — by hand on the sheet, or by a module that watches for the
// card (Workbench's handleDyingRecoveryRoll, giveWoundedWhenDyingRemoved). This
// matches base PF2e exactly, which is the point: a tablet roll and a roll from
// the desktop sheet leave the world in the same state, and a table's existing
// automation stays the only thing applying results.
//
// The app's condition modal already steps the dying value with the +/- buttons
// every valued condition gets, so "roll here, then adjust" is one screen.
export const handleRecovery: CheckRollHandler = (ctx) => {
  const { actor, params } = ctx
  // Not a creature (a hazard, a loot actor) has no dying track at all; a
  // creature at dying 0 isn't dying, and PF2e's own method answers null rather
  // than rolling. Both mean the app's state has drifted from the world's, so
  // refuse loudly instead of acking a roll that never happened.
  if (!actor.isOfType('creature')) throw new Error(`${actor.name} cannot make a recovery check`)
  if (!actor.attributes.dying?.value) throw new Error(`${actor.name} is not dying`)
  return actor.rollRecovery(params.event)
}
