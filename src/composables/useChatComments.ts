import { ref } from 'vue'
import { setComment as setCommentRpc } from '@/api/actionRpc'
import { sanitizeCommentText, type ChatComment } from '@/utils/chatComments'
import { useWorldStore } from '@/stores/world'

// Writing comments on chat messages, without the rest of the chat surface.
//
// It lives here rather than inside useChatActions because two very different
// places write comments: the chat overlay (which has the whole ChatActions
// surface) and the roll-result modal, which is a leaf component on a character
// sheet with no actor context, no message list, and no business instantiating
// the chat composer to add one line of text to a card.
//
// The write is an RPC through the GM client for a sharper reason than reactions:
// a roll made from the app is POSTED BY that GM client (PF2e's roll pipelines
// run there), so its author is the GM and not even the roller can update it over
// the socket. Anyone may comment on any message; only a comment's own author (or
// a GM) may rewrite one, which the module enforces.
//
// Deliberately NOT optimistic, unlike a reaction chip: this is a considered
// write behind a Save button rather than a tap that must feel instant, and the
// ack carries the authoritative list (which may also hold a comment someone else
// added while this one was being typed). Applying only what came back keeps the
// list correct without needing a rollback path.
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

    // Sanitize before the pending check as well as before sending: the module
    // sanitizes again (it can't trust the wire), and an add whose text is empty
    // after trimming is a no-op there, so don't spend a round trip on it.
    const clean = sanitizeCommentText(text)
    if (!clean && !commentId) return null

    const entry = key(messageId, commentId)
    if (pending.value.has(entry)) return null

    setPending(entry, true)
    try {
      const ack = await setCommentRpc(messageId, clean, commentId)
      // Fold the stored list into the cached world so the log updates without
      // waiting for Foundry's own broadcast to come back around.
      worldStore.applyChatComments(messageId, ack.comments)
      return ack.comments
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
