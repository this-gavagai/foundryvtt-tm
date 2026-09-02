import type { NextTurnArgs } from '@/types/api-types'
import { getGame, makeAck } from '../utils/foundry'

// End the current combatant's turn, run on the GM's Foundry client.
//
// Foundry's own turn controls are GM-only for a structural reason: a Combat has
// no ownership map, so `Combat#nextTurn` — which is an update to that document —
// can only be called by a user Foundry considers able to update it. The app's
// "End Turn" button therefore has to arrive here, as reactions and comments do.
//
// The two checks below are what makes it safe to expose to a player, and neither
// can live in the RPC table's authorization gate:
//
//   * The gate proves the requester OWNS args.actorId (rpcAuthorize's 'owner'),
//     which is necessary but not sufficient — every player owns some actor, so
//     on its own it would let anyone end anyone's turn. Requiring that actor to
//     hold the turn is what limits a player to their own.
//
//   * The turn the app was showing must still be the live one. Requests are
//     dispatched strictly one at a time (see the chain in listener.ts), so a tap
//     can sit behind a multi-second roll; without the round/turn match, a late
//     tap would advance past the player who had meanwhile started their turn.
//
// A GM is exempt from the ownership half — they can advance the tracker for
// anyone in Foundry, and the app's turn bar offers them the same. The staleness
// check still applies to them: it guards against a queued request, not against
// the requester.
//
// PF2e's turn-boundary automation (Combatant#onEndTurn / onStartTurn: sustained
// spells, turn-duration effects, recharges, the pf2e.startTurn hook) hangs off
// the document update this makes, so routing the tap through a client is what
// gets a player's remotely-ended turn treated exactly like a GM-ended one.
export async function foundryNextTurn(args: NextTurnArgs) {
  const source = getGame()
  const combat = source.combats.get(args.combatId)
  if (!combat) throw new Error(`no encounter ${args.combatId}`)
  // `started` is legitimate HERE and only here: this is a live Combat document,
  // where it is a getter. The app cannot read it — it is not a stored field, so
  // the world dump never carries it — and derives it instead (stores/combat.ts).
  if (!combat.started) throw new Error(`encounter ${args.combatId} has not started`)

  // Same-turn check. `turn` is an index into the sorted turn order, so a
  // combatant joining or rolling initiative can renumber it without the round
  // changing — comparing both, plus the combatant the app believed was up,
  // catches every reshuffle the app could have missed.
  if (combat.round !== args.round || combat.turn !== args.turn) {
    throw new Error(
      `turn already advanced (asked for round ${args.round} turn ${args.turn}, ` +
        `now round ${combat.round} turn ${combat.turn})`
    )
  }

  const current = combat.combatant
  if (!current) throw new Error(`encounter ${args.combatId} has no current combatant`)

  const requester = source.users.get(args.userId)
  if (!requester?.isGM && current.actorId !== args.actorId) {
    throw new Error(`${args.actorId} does not hold the current turn`)
  }

  await combat.nextTurn()
  return makeAck(args)
}
