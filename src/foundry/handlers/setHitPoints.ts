import type { SetHitPointsArgs } from '@/types/api-types'
import { getGame, getCharacter, makeAck } from '../utils/foundry'

// Manual hit-point edits, run on the GM's Foundry client.
//
// The app writes almost everything straight at the server over `modifyDocument`
// (api/documents.ts) — no GM needed, no proxy hop. Hit points can't work that
// way, because Foundry splits a document update into two phases and only one of
// them is broadcast:
//
//   #preUpdateDocumentArray  → Actor#_preUpdate, Hooks.call('preUpdateActor')
//                              runs ONLY on the client calling actor.update()
//   #handleUpdateDocuments   → Actor#_onUpdate, Hooks.callAll('updateActor')
//                              runs on EVERY client receiving the broadcast
//
// A raw socket emit skips phase one on every client, because no client ever
// calls actor.update(). That is where the HP automation lives: Workbench hangs
// autoGainDyingAtZeroHP, autoRemoveDyingAtGreaterThanZeroHP and
// autoRemoveUnconsciousAtGreaterThanZeroHP off `preUpdateActor` (it needs the
// old and new values, which only both exist before the write lands), and PF2e
// synthesizes `options.damageTaken` in its own _preUpdate — which is what gives
// a sheet edit its floaty damage numbers.
//
// So the fix is simply to make the write happen on a client. A plain update is
// deliberately all this does: PF2e's own character sheet treats hit points as an
// ordinary form field (`<input name="system.attributes.hp.value" data-allow-delta>`
// in templates/actors/character/partials/sidebar.hbs), where `data-allow-delta`
// resolves a typed ±N into an absolute in the input and the sheet then submits
// it like any other field. Only the token HP bar routes through
// `applyDamage` (ActorPF2e#modifyTokenAttribute), and this modal is a sheet
// field, not the bar — so no IWR, no shield block, no damage card, and the
// number the player typed is the number they get.
export async function foundrySetHitPoints(args: SetHitPointsArgs) {
  const source = getGame()
  const actor = getCharacter(source, args.characterId)
  if (!actor.hitPoints) throw new Error(`${actor.name} has no hit points to set`)

  // One update, not two: `preUpdateActor` sees the whole edit at once, so a
  // module deciding whether this crossed 0 reads the same state a GM's own
  // sheet submission would give it.
  const changes: Record<string, number> = {}
  if (typeof args.value === 'number') changes['system.attributes.hp.value'] = args.value
  if (typeof args.temp === 'number') changes['system.attributes.hp.temp'] = args.temp
  if (Object.keys(changes).length) await actor.update(changes)

  return makeAck(args)
}
