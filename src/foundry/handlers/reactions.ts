// Toggle a user's emoji reaction on a chat message.
//
// Why this is an RPC at all: the app posts, edits, and deletes chat messages
// directly over the modifyDocument socket as its own Foundry user (see
// useChatActions.postChatMessageDirect), which works because Foundry authorizes
// an author modifying their own message. A reaction is by definition a write to
// someone else's message, and only the author or a GM may do that — so it has to
// run on a GM client. The cost is that reactions, unlike sending a message,
// need a GM online.
//
// Trust model: `args.userId` is self-reported over Foundry's module channel and
// can't be authenticated there (same as every other RPC). What this handler can
// and does guarantee is that a request only ever moves ONE entry — the reacting
// user's own — and only for an emoji from the shared palette. The client never
// sends a reaction list, so a buggy or hostile tablet can't clear the table's
// reactions or store arbitrary strings in the flag.

import type { ToggleReactionArgs } from '@/types/api-types'
import { MODULE_ID } from '@/api/protocol'
import { getGame, makeAck } from '../utils/foundry'
import {
  isReactionEmoji,
  readReactions,
  toggleReaction,
  type ChatReaction,
  type ReactionFlagSource
} from '@/utils/chatReactions'

// Structural view of what we need off a ChatMessage. Foundry's own types don't
// describe tablemate flags, and setFlag's signature varies across versions.
type ReactableMessage = ReactionFlagSource & {
  setFlag?: (scope: string, key: string, value: unknown) => Promise<unknown>
}

export async function foundryToggleReaction(args: ToggleReactionArgs) {
  // Reject an unknown emoji rather than storing it: the flag is rendered as text
  // in the app and in the Foundry chat log, and the palette is the contract both
  // ends agree on. Throwing lets the dispatch's central catch answer with an
  // error ack, so the app rolls its optimistic chip back immediately.
  if (!isReactionEmoji(args.emoji)) {
    throw new Error(`Unsupported reaction emoji: ${args.emoji}`)
  }

  const source = getGame()
  const message = source.messages.get(args.messageId) as unknown as ReactableMessage | undefined
  if (!message) throw new Error(`Chat message ${args.messageId} not found`)

  if (typeof message.setFlag !== 'function') {
    throw new Error(`Chat message ${args.messageId} cannot store flags`)
  }

  // Read-modify-write. Safe against two players tapping at once because the
  // listener runs this on the dispatch chain (reactions are deliberately NOT in
  // CONCURRENT_ACTIONS) and routes every reaction to the first active GM, so all
  // of a message's toggles serialize through one client.
  const current: ChatReaction[] = readReactions(message)
  const reactions = toggleReaction(current, args.emoji, args.userId)

  // setFlag replaces the array wholesale (Foundry treats arrays as atomic in a
  // document diff), which is exactly what the app-side merge expects — see the
  // shape note in utils/chatReactions.ts.
  await message.setFlag(MODULE_ID, 'reactions', reactions)

  // Hand back the stored list so the requester reconciles rather than trusting
  // its own optimistic guess.
  return { ...makeAck(args), reactions }
}
