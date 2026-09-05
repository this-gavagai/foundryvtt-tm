import type { ActorPF2e } from '@7h3laughingman/pf2e-types'
import type { RestForTheNightArgs } from '@/types/api-types'
import { getGame, makeAck } from '../utils/foundry'

// Rest for the Night, run on the GM's Foundry client.
//
// This is a thin wrapper around PF2e's own `restForTheNight` and is meant to
// stay one. That function does a long list of things — recovers hit points by
// Constitution × level, steps doomed and drained down, clears fatigued, removes
// wounded at full health, refills spell slots, focus points, wand charges,
// infused reagents, stamina and resolve, resets daily crafting, recharges every
// `day`-duration resource, deletes temporary items, and posts a card itemising
// what changed — and every line of it is a rule the system owns. A copy here
// would be a second implementation drifting a release at a time, in a module
// whose whole premise is that the sheet is a view of PF2e's answers.
//
// It also fires the `pf2e.restForTheNight` hook, which is where pf2e-dailies and
// the other daily-preparation modules do their work. Calling PF2e's function is
// what makes a rest from the tablet identical to a rest from the Foundry sheet,
// module automation included; anything reimplemented here would silently do
// less at exactly the tables that automate the most.
//
// `skipDialog` is always set. PF2e's confirmation is a DialogV2 on the client
// that runs it — the GM's — for a question the player holding the tablet is the
// one answering, so it would hang the request behind a prompt nobody is looking
// at. The app asks on the device that tapped, before sending this.

// PF2e hangs its quasi-action functions (restForTheNight, treatWounds,
// takeABreather…) off `game.pf2e.actions` as plain properties, beside the
// Collection of Action entries the same object holds. The types package can only
// describe those as `Record<string, Function>`, so this names the one signature
// being called — PF2e's own, from scripts/macros/rest-for-the-night.ts.
type RestForTheNightFn = (options: {
  actors: ActorPF2e | ActorPF2e[]
  skipDialog?: boolean
}) => Promise<unknown>

export async function foundryRestForTheNight(args: RestForTheNightArgs) {
  const source = getGame()
  const actor = source.actors.get(args.characterId, { strict: true })

  // PF2e filters non-characters out of its own `actors` list and reports the
  // empty result with `ui.notifications.error` — on the GM's screen, where
  // nobody asked for it, while the app's request acks as though it worked.
  // Refusing here turns that into an error the tablet can show.
  if (actor.type !== 'character') {
    throw new Error(`${args.characterId} is a ${actor.type}, and only a character can rest`)
  }

  // Probed rather than assumed: a PF2e version that renamed or moved this leaves
  // a property access returning undefined, and calling it would throw something
  // far less legible than the ack this produces. systemCompat checks the same
  // name at ready and warns the GM once.
  const rest = source.pf2e?.actions?.restForTheNight
  if (typeof rest !== 'function') {
    throw new Error('this PF2e version has no game.pf2e.actions.restForTheNight')
  }

  await (rest as RestForTheNightFn)({ actors: actor, skipDialog: true })
  return makeAck(args)
}
