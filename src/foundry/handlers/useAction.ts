import type { UseActionArgs } from '@/types/api-types'
import { getGame, makeAck } from '../utils/foundry'

// "Use" an action / feat — the button PF2e's own sheets put on any ability they
// consider usable (templates/actors/partials/action.hbs and the NPC twin), and
// the other half of the limited-use indicator the app now shows on those rows.
//
// PF2e's chain is
//   sheet [data-action=use-action] → createUseActionMessage(item, mode)
// which, for an item with a Frequency, decrements `system.frequency.value` by
// one and then posts the item's chat card. That function isn't exported, but
// `game.pf2e.rollItemMacro(uuidOrId, event)` routes straight into it for
// `action` and `feat` items — it is the same entry point PF2e wires to a
// hotbar-dropped ability, and the one runActionable already hands authored
// toolbelt macros as their `use()` callback. Calling it here rather than
// writing the frequency ourselves keeps every part of the behavior the
// system's: which items decrement, what the card looks like, the self-effect
// card and its Apply Effect button, and whatever PF2e adds next.
//
// It has to run on a Foundry client at all because both halves are privileged:
// the frequency write is an item update on someone else's actor, and the card
// is rendered by PF2e's own Handlebars templates.
export async function foundryUseAction(args: UseActionArgs) {
  const source = getGame()
  // Failures throw: the dispatch's central catch turns them into error acks, so
  // the app rejects rather than reporting a use that never happened — and, more
  // to the point, never shows a use as spent when the frequency didn't move.
  const actor = source.actors.get(args.characterId, { strict: true })
  const item = actor.items.get(args.itemId)
  if (!item) throw new Error(`Item ${args.itemId} not found on ${actor.name}`)
  // Only the two types PF2e's own use path handles. Anything else falls through
  // rollItemMacro to a bare `toMessage()`, which posts a card while spending
  // nothing — a silent no-op dressed as a success, so refuse it instead.
  if (item.type !== 'action' && item.type !== 'feat') {
    throw new Error(`${item.name} (${item.type}) is not a usable action`)
  }

  const rollItemMacro = source.pf2e.rollItemMacro
  if (typeof rollItemMacro !== 'function') {
    throw new Error('PF2e rollItemMacro is unavailable')
  }

  // Address the item by UUID, not id. rollItemMacro's id branch resolves the
  // actor from `ChatMessage.getSpeaker()` — this client's own token/character
  // selection, i.e. the handling GM's, not the requester's — and would use the
  // wrong creature's ability or none at all. The UUID branch takes the item
  // straight from fromUuid().
  //
  // `null` event: PF2e's eventToMessageMode only looks at the ctrl/cmd key, and
  // holding it makes the card private. No event means the public message mode
  // every other card this module posts uses.
  await rollItemMacro(item.uuid, null)
  return makeAck(args)
}
