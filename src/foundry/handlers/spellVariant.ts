import type { ActorPF2e, SpellPF2e } from '@7h3laughingman/pf2e-types'
import type { SelectSpellVariantArgs } from '@/types/api-types'
import { getCharacter, getGame, makeAck } from '../utils/foundry'

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

type VariantSpell = SpellPF2e<ActorPF2e> & {
  loadVariant: (options: {
    overlayIds?: string[]
    castRank?: number
  }) => VariantSpell | null | undefined
  loadBaseVariant: () => VariantSpell
  toMessage: (
    event: null,
    options: { create: false; data?: { castRank: number } }
  ) => Promise<VariantCardMessage | null | undefined>
}

// The un-created ChatMessage that toMessage({ create: false }) hands back: a
// real document instance, so it can be cloned with the original's whisper list
// before being flattened into an update payload.
type VariantCardMessage = {
  clone: (data: { whisper: string[] }) => { toObject: () => Record<string, unknown> }
}

type SpellCardMessage = {
  _source?: { whisper?: string[]; author?: string | null }
  whisper?: string[]
  author?: { id?: string; _id?: string } | string | null
  speaker?: { actor?: string | null } | null
  item?: {
    isOfType?: (...types: string[]) => boolean
    embeddedSpell?: unknown
  } | null
  update: (data: object) => Promise<unknown>
}

// The spell behind the card. A consumable (scroll/wand) card carries its spell
// as an embedded item, exactly as PF2e's own handler resolves it.
function spellFromMessage(message: SpellCardMessage): VariantSpell | null {
  const item = message.item
  if (!item) return null
  if (item.isOfType?.('spell')) return item as unknown as VariantSpell
  if (item.isOfType?.('consumable')) return (item.embeddedSpell as VariantSpell) ?? null
  return null
}

// Who posted the card. Read from _source first — that's the stored id — and
// fall back to the resolved User document for shapes that only expose it there.
function originalAuthorId(message: SpellCardMessage): string | undefined {
  const stored = message._source?.author
  if (typeof stored === 'string' && stored) return stored
  const author = message.author
  if (typeof author === 'string') return author || undefined
  return author?.id ?? author?._id ?? undefined
}

export async function foundrySelectSpellVariant(args: SelectSpellVariantArgs) {
  const source = getGame()
  const actor = getCharacter(source, args.characterId)

  // Every failure throws: the dispatch's catch turns it into an error ack, so
  // the app reports the tap as failed rather than leaving a spinner on a card
  // that never changed.
  const message = source.messages.get(args.messageId) as unknown as SpellCardMessage | undefined
  if (!message) throw new Error(`Chat message ${args.messageId} not found`)

  // Ownership of the actor is already checked by the dispatch (AUTH_POLICY),
  // but that only proves the requester owns SOME actor — pin it to the one this
  // card was cast by, so a player can't rewrite another character's card.
  if (message.speaker?.actor !== actor._id) {
    throw new Error('Spell card belongs to a different actor')
  }

  const spell = spellFromMessage(message)
  if (!spell) throw new Error(`Chat message ${args.messageId} is not a spell card`)

  const castRank = Number.isInteger(args.castRank) && args.castRank > 0 ? args.castRank : 1
  // No overlays means the "base variant" button: revert the card to the
  // un-overlaid spell (PF2e's else-branch).
  const variant = args.overlayIds.length
    ? spell.loadVariant({ overlayIds: args.overlayIds, castRank })
    : spell.loadBaseVariant()
  if (!variant) throw new Error(`Spell variant could not be loaded for ${args.messageId}`)

  const card = await variant.toMessage(null, {
    create: false,
    ...(args.overlayIds.length ? { data: { castRank } } : {})
  })
  if (!card) throw new Error(`Spell variant produced no chat card for ${args.messageId}`)

  const whisper = message._source?.whisper ?? message.whisper ?? []
  const update = card.clone({ whisper }).toObject()
  const author = originalAuthorId(message)

  await message.update(author ? { ...update, author } : update)

  return makeAck(args)
}
