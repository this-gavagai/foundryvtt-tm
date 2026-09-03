import { ref } from 'vue'
import { updateUserFlag } from '@/api/documents'
import { uuidv4 } from '@/utils/utilities'
import {
  readUserComments,
  sanitizeCommentText,
  upsertUserComment,
  type ChatComment
} from '@/utils/chatComments'
import { useWorldStore } from '@/stores/world'
import { useUserStore } from '@/stores/user'

// Writing comments on chat messages, without the rest of the chat surface.
//
// It lives here rather than inside useChatActions because two very different
// places write comments: the chat overlay (which has the whole ChatActions
// surface) and the roll-result modal, which is a leaf component on a character
// sheet with no actor context, no message list, and no business instantiating
// the chat composer to add one line of text to a card.
//
// A DIRECT socket write, as this app's own Foundry user. A comment is stored on
// its AUTHOR's User document (utils/chatComments.ts), which a user may write
// themselves — so no GM need be online.
//
// That it could not always be direct is worth remembering: on the message, a
// comment was a write to someone else's document, and sharply so, because a roll
// made from the app is POSTED BY the GM's client, making the GM its author. Not
// even the roller could update their own roll.
//
// The "only a comment's author may rewrite it" rule is gone from this file and
// from the module, because it is no longer a rule anyone has to enforce: you can
// only write your own document. A GM moderating someone else's comment still
// works, and directly — Foundry grants a GM update rights on any user.
//
// Deliberately NOT optimistic, unlike a reaction chip: this is a considered
// write behind a Save button rather than a tap that must feel instant. It writes
// the whole list it computed, so what it applies locally IS what it sent.
//
// State is per-instance, so each editor tracks its own in-flight writes.
export function useChatComments() {
  const worldStore = useWorldStore()

  // Keyed `${messageId}:${commentId ?? 'new'}` — one in-flight write per comment,
  // so a double-tap on Save can't post the same one twice.
  const pending = ref(new Set<string>())
  // Whether the last write failed (no GM online, a refusal, a timeout). Callers
  // surface it; it clears when the next write starts.
  const failed = ref(false)

  function key(messageId: string, commentId?: string | null): string {
    return `${messageId}:${commentId ?? 'new'}`
  }

  function isCommentPending(
    messageId: string | null | undefined,
    commentId?: string | null
  ): boolean {
    return !!messageId && pending.value.has(key(messageId, commentId))
  }

  function setPending(entry: string, value: boolean) {
    const next = new Set(pending.value)
    if (value) next.add(entry)
    else next.delete(entry)
    pending.value = next
  }

  // Write, edit, or remove one comment. Resolves with the message's stored
  // comment list, or null when the write failed or there was nothing to write —
  // an editor should stay open on null, since the text is still the user's only
  // copy.
  //
  // The list rather than a bare boolean because a caller may not be able to read
  // it back any other way: the roll-result panel offers a comment on a card that
  // may not have reached the app's message cache yet, so the ack is where it
  // learns which comment it just wrote.
  async function saveComment(
    messageId: string | null | undefined,
    text: string,
    commentId?: string
  ): Promise<ChatComment[] | null> {
    // Cleared up front, not just before the request: an editor that reopens
    // after a failure must not still be showing the last attempt's error.
    failed.value = false
    if (!messageId) return null
    const userId = useUserStore().userId
    if (!userId) return null

    // Sanitized here and again on read (utils/chatComments), since the stored
    // flag is world-readable data no reader should trust. An add whose text is
    // empty after trimming is a no-op rather than a write.
    const clean = sanitizeCommentText(text)
    if (!clean && !commentId) return null

    const entry = key(messageId, commentId)
    if (pending.value.has(entry)) return null

    // Editing addresses a comment on OUR OWN document, so an id we don't hold is
    // either a stale editor or someone else's comment — neither of which this
    // write can touch. Refuse rather than silently adding a second comment.
    const stored = readUserComments(worldStore.userById(userId))
    if (commentId && !stored.some((c) => c.id === commentId)) {
      failed.value = true
      return null
    }

    const next = upsertUserComment(stored, {
      id: commentId ?? uuidv4(),
      messageId,
      text: clean,
      timestamp: Date.now()
    })

    setPending(entry, true)
    try {
      await updateUserFlag(userId, 'comments', next)
      worldStore.applyUserAnnotations(userId, 'comments', next)
      // The message's whole thread, across every author — which is what the
      // caller renders, and which this user's own list is only part of. The
      // roll-result panel in particular may be commenting on a card the app has
      // not cached, so it has no other way to read the thread back.
      return worldStore.commentsFor(messageId)
    } catch {
      // Nothing was written, so there is nothing to undo — just report it.
      failed.value = true
      return null
    } finally {
      setPending(entry, false)
    }
  }

  // Removing is the same write with empty text — see SetCommentArgs.
  function removeComment(
    messageId: string | null | undefined,
    commentId: string
  ): Promise<ChatComment[] | null> {
    return saveComment(messageId, '', commentId)
  }

  return { saveComment, removeComment, isCommentPending, commentFailed: failed }
}
