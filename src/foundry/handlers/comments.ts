// Write, edit, or remove one free-text comment on a chat message.
//
// Why this is an RPC rather than a direct write from the app: the app posts,
// edits and deletes its OWN messages over the modifyDocument socket (see
// useChatActions.postChatMessageDirect), which works because Foundry authorizes
// an author modifying their own message. A comment is by definition a write to
// someone else's message most of the time — and even when it isn't, it usually
// still is: a roll made from the app is produced HERE, on the GM's client, so
// the ChatMessage's author is the GM and the player who rolled it is recorded
// only in flags.tablemate.originUserId. Either way the write has to run on a GM
// client.
//
// The rules:
//
//   • anyone logged into the world may comment on any message — a table talks
//     about each other's rolls, and that is the whole point of the feature;
//   • a comment may be edited or removed only by the person who wrote it, or by
//     a GM (who moderates the log the same way they can delete any message).
//
// Note that those are two different questions. Being able to comment on a
// message does not confer editorial control over what someone else wrote about
// it: a GM's comment on a player's roll stays the GM's, and vice versa.
//
// Trust model: `args.userId` is self-reported over Foundry's module channel and
// can't be authenticated there (same as every other RPC — see rpcAuthorize.ts).
// What this handler guarantees is containment: a request only ever touches ONE
// comment, the comment it writes is stamped with the requester's own id, and the
// text is re-sanitized here rather than trusted as the app sent it.

import type { GamePF2e } from '@7h3laughingman/pf2e-types'
import type { SetCommentArgs } from '@/types/api-types'
import { MODULE_ID, TM_ERROR_UNAUTHORIZED } from '@/api/protocol'
import { getGame, makeAck } from '../utils/foundry'
import { uuidv4 } from '@/utils/utilities'
import {
  canModifyComment,
  findComment,
  readComments,
  removeComment,
  sanitizeCommentText,
  upsertComment,
  type ChatComment
} from '@/utils/chatComments'

// Enough of a ChatMessage for the flag write. Structural so a test can pass a
// plain object, like the reaction handler's.
type CommentableMessage = {
  flags?: Record<string, unknown> | null
  getFlag?: (scope: string, key: string) => unknown
  setFlag?: (scope: string, key: string, value: unknown) => Promise<unknown>
}

// The Foundry user ids a requester counts as. A sheet-only user (e.g. "Peter's
// Sheet") is attached to a human's login user through the tablemate.belongsTo
// flag, so a comment written from either reads as that person's for the
// edit-your-own rule.
//
// Deliberately the same widening the APP uses (currentUserIds in
// useChatVisibility) — self plus the user it belongs to, and not the reverse —
// so the gate here can't refuse an edit the UI just offered.
export function commentIdentityIds(source: GamePF2e, userId: string): Set<string> {
  const ids = new Set<string>([userId])
  const user = source.users.get(userId)
  const owner = user?.getFlag?.(MODULE_ID, 'belongsTo')
  if (typeof owner === 'string' && owner) ids.add(owner)
  return ids
}

export async function foundrySetComment(args: SetCommentArgs) {
  const source = getGame()
  const message = source.messages.get(args.messageId) as CommentableMessage | undefined
  if (!message) throw new Error(`Chat message ${args.messageId} not found`)

  if (typeof message.setFlag !== 'function') {
    throw new Error(`Chat message ${args.messageId} cannot store flags`)
  }

  // Commenting itself needs nothing beyond being a known user of this world —
  // which the dispatch gate has already checked ('world-user', see rpcTable.ts).
  // This resolves the user again only for the isGM half of the edit rule below,
  // and to fail closed if the id names nobody.
  const user = source.users.get(args.userId)
  if (!user) throw new Error(TM_ERROR_UNAUTHORIZED)
  const isGM = !!user.isGM

  // Read-modify-write, safe against two people writing at once because
  // SET_COMMENT is deliberately NOT in the concurrent set (see rpcTable.ts):
  // every comment on every message serializes through one GM client's dispatch
  // chain.
  const current: ChatComment[] = readComments(message)
  const text = sanitizeCommentText(args.text)

  let next: ChatComment[]
  if (args.commentId) {
    // Editing or removing an existing comment. One that is no longer there is an
    // error rather than a fresh add: it means someone removed it while this edit
    // was being typed, and silently re-adding it would undo that removal.
    const existing = findComment(current, args.commentId)
    if (!existing) throw new Error(`Comment ${args.commentId} not found`)
    if (!canModifyComment(existing, commentIdentityIds(source, args.userId), isGM)) {
      throw new Error(TM_ERROR_UNAUTHORIZED)
    }
    next = text
      ? upsertComment(current, { ...existing, text })
      : removeComment(current, args.commentId)
  } else {
    // Adding. Empty text is a no-op rather than an error — the app already
    // refuses to send one, and there is nothing to write.
    if (!text) return { ...makeAck(args), comments: current }
    next = upsertComment(current, {
      // The requester's own id, never one it sent: a comment always reads as
      // written by whoever asked for it.
      id: uuidv4(),
      userId: args.userId,
      text,
      timestamp: Date.now()
    })
  }

  // setFlag replaces the array wholesale (Foundry treats arrays as atomic in a
  // document diff), which is what the app-side merge expects — see the shape
  // note in utils/chatComments.ts.
  await message.setFlag(MODULE_ID, 'comments', next)

  // Hand back the stored list so the requester reconciles rather than trusting
  // its own optimistic guess.
  return { ...makeAck(args), comments: next }
}
