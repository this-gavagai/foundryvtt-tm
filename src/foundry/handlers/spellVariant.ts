import type { ActorPF2e, ChatMessagePF2e, SpellPF2e } from '@7h3laughingman/pf2e-types'
import type { SelectSpellVariantArgs } from '@/types/api-types'
import { getCharacter, getGame, makeAck } from '../utils/foundry'

// A posted spell card. Just a chat message — the local shape this used to carry
// (with `author` as string-or-document and every field optional) described
// nothing pf2e-types does not, and loadVariant / loadBaseVariant / toMessage /
// clone are all on the real SpellPF2e and ChatMessagePF2e too.
type SpellCardMessage = ChatMessagePF2e

// Swap a posted spell card to one of the variants its buttons offer ("Heal 1",
// "Heal (vs. Undead) 2", …).
//
// This mirrors PF2e's own `spell-variant` chat-card action (system module,
// ChatMessagePF2e#onClickAction) rather than inventing a behavior: the variant
// REPLACES the existing card in place — it does NOT post a second message and
// it does NOT re-spend a slot. Reproducing it app-side isn't possible; building
// the variant's card HTML needs the system's spell rendering, which only exists
// on a Foundry client.
//
// Two fields of the original message are carried over onto the rewritten card,
// because toMessage() builds a FRESH document that knows nothing about the one
// being replaced:
//
//   whisper — a privately-cast spell must not become public by tapping one of
//             its own buttons. (PF2e carries this over too.)
//   author  — the new document is authored by whoever ran toMessage(), which
//             here is the GM client acting as proxy, NOT the player who tapped.
//             Left alone, a player picking a variant hands their card over to
//             the GM: it re-attributes in the chat log and stops being theirs
//             to edit or delete. PF2e has no equivalent line because in Foundry
//             the player clicks the button on their own client.

// The spell behind the card. A consumable (scroll/wand) card carries its spell
// as an embedded item, exactly as PF2e's own handler resolves it.
function spellFromMessage(message: SpellCardMessage): SpellPF2e<ActorPF2e> | null {
  const item = message.item
  if (!item) return null
  if (item.isOfType('spell')) return item
  if (item.isOfType('consumable')) return item.embeddedSpell
  return null
}

// Who posted the card. Read from _source first — that's the stored id — and fall
// back to the resolved User document.
function originalAuthorId(message: SpellCardMessage): string | undefined {
  return message._source.author || message.author?.id || undefined
}

// Rewrite a posted spell card to one of the spell's variants (or, with no
// overlays, back to the base version).
//
// Shared by the two ways a variant gets chosen: tapping a variant button on the
// card, and picking one before casting — the cast posts its normal card and
// this immediately rewrites it. Casting deliberately does NOT take a different
// route: `spellLocation.cast()` stays the single call every module wrapper in
// the world sees, and a cast that spends no slot posts no card, so there is
// nothing here to rewrite and no way to show a card for a cast that didn't
// happen.
export async function applySpellVariantToCard(
  message: SpellCardMessage,
  overlayIds: string[],
  requestedRank?: number
): Promise<void> {
  const spell = spellFromMessage(message)
  if (!spell) throw new Error('Chat message is not a spell card')

  // The rank belongs to the cast the card records, so the card is the better
  // source. An explicit rank still wins — a chat-card click reads data-cast-rank
  // straight off the DOM it was rendered from, which is the same value.
  const requested = requestedRank ?? message.flags?.pf2e?.origin?.castRank ?? undefined
  const castRank =
    typeof requested === 'number' && Number.isInteger(requested) && requested > 0 ? requested : 1
  // No overlays means the "base variant" button: revert the card to the
  // un-overlaid spell (PF2e's else-branch).
  const variant = overlayIds.length
    ? spell.loadVariant({ overlayIds, castRank })
    : spell.loadBaseVariant()
  if (!variant) throw new Error('Spell variant could not be loaded')

  const card = await variant.toMessage(null, {
    create: false,
    ...(overlayIds.length ? { data: { castRank } } : {})
  })
  if (!card) throw new Error('Spell variant produced no chat card')

  const whisper = message._source?.whisper ?? message.whisper ?? []
  const update = card.clone({ whisper }).toObject()
  const author = originalAuthorId(message)

  await message.update(author ? { ...update, author } : update)
}

// Locate a posted spell card and confirm it belongs to the requesting actor.
export function spellCardOf(
  source: ReturnType<typeof getGame>,
  messageId: string,
  actorId: string | null | undefined
): SpellCardMessage {
  const message = source.messages.get(messageId)
  if (!message) throw new Error(`Chat message ${messageId} not found`)
  // Ownership of the actor is already checked by the dispatch (AUTH_POLICY),
  // but that only proves the requester owns SOME actor — pin it to the one this
  // card was cast by, so a player can't rewrite another character's card.
  if (message.speaker?.actor !== actorId) {
    throw new Error('Spell card belongs to a different actor')
  }
  return message
}

export async function foundrySelectSpellVariant(args: SelectSpellVariantArgs) {
  const source = getGame()
  const actor = getCharacter(source, args.characterId)

  // Every failure throws: the dispatch's catch turns it into an error ack, so
  // the app reports the tap as failed rather than leaving a spinner on a card
  // that never changed.
  const message = spellCardOf(source, args.messageId, actor._id)
  await applySpellVariantToCard(message, args.overlayIds, args.castRank)

  return makeAck(args)
}
