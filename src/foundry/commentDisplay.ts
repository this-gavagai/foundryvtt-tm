// Renders chat-message comments into the Foundry chat log, and lets a
// Foundry-client user write, edit, or remove their own.
//
// Comments are a Tablemate concept stored in flags.tablemate.comments (see
// utils/chatComments.ts), so the desktop chat log knows nothing about them.
// Without this, a comment written from a tablet would be invisible to everyone
// sitting at the actual Foundry client — and the GM, the likeliest person to
// want to remark on a roll, would have no way to do it from the screen they are
// already looking at.
//
// This is the twin of reactionDisplay.ts and follows it closely, including the
// two decisions that are load-bearing there:
//
//   • the entry point for a FIRST comment is Foundry's own right-click menu,
//     extended via the context-menu hook rather than a `contextmenu` listener of
//     our own (which would have to preventDefault and so suppress core's "Delete",
//     "Reveal to Everyone", and every entry other modules add);
//   • that hook must be registered from `init`. ChatLog builds its context menu
//     once, in _onFirstRender, and ContextMenu captures the entry array for its
//     lifetime — a module registering at `ready` has already missed it.
//
// Styling is inline for the same reason as the reaction chips: the module ships
// no stylesheet Foundry loads.

import type { ContextMenuEntry } from '@7h3laughingman/foundry-types/client/applications/ux/context-menu.mjs'
import { MODULE_ID } from '@/api/protocol'
import { logger, uuidv4 } from '@/utils/utilities'
import {
  COMMENT_MAX_LENGTH,
  canModifyComment,
  indexUserComments,
  readComments,
  readUserComments,
  sanitizeCommentText,
  upsertUserComment,
  type ChatComment
} from '@/utils/chatComments'
import {
  chatMessageElement,
  findRenderedChatMessage,
  type TablemateChatMessage
} from './utils/chatMessage'
import { commentsEnabled } from './featureToggles'
import { onHook } from './globals'

// Narrowed local shape for core's DialogV2 prompt.
//
// The real declaration takes DeepPartial<DialogV2Configuration & …>, and
// DialogV2Configuration extends ApplicationConfiguration — deep enough that
// instantiating it at a call site trips TS's recursion limit (TS2589). A
// module-scoped `declare` shadows the ambient global for this file only, which
// is the same idiom the Roll / Macro / fromUuidSync shapes use elsewhere in
// this folder; the fields below are exactly the ones this call passes.
declare const foundry: {
  applications: {
    api: {
      DialogV2: {
        prompt: (config: {
          window: { title: string }
          content: HTMLElement
          rejectClose: boolean
          ok: {
            label: string
            callback: (event: unknown, button: HTMLButtonElement) => string
          }
        }) => Promise<unknown>
      }
    }
  }
}

let commentDisplayRegistered = false
let commentContextMenuRegistered = false

const CONTAINER_CLASS = 'tm-comments'
const COMMENT_CLASS = 'tm-comment'

type CommentableMessage = TablemateChatMessage

function messageId(message: CommentableMessage): string | undefined {
  return message?.id ?? message?._id ?? undefined
}

// Ask for a comment write. A GM can write the flag itself, so it runs the
// handler locally — the socket doesn't echo an emit back to its sender, so a
// lone GM emitting would never be answered. Everyone else goes over the wire to
// the first active GM, exactly as the app does.
//
// Same trade as reactionDisplay.requestToggle: the local call sidesteps the
// dispatch chain, so a GM saving a comment in the same millisecond a tablet's
// write is mid-flight could lose one of the two. A single click against a
// concurrent tap, and the loser retypes.
async function requestComment(
  messageId: string,
  text: string,
  commentId?: string,
  // The comment's author, when editing or removing one. A GM moderating someone
  // else's comment writes THEIR document, which Foundry permits
  // (common/documents/user.mjs grants a GM update rights on any user).
  authorId?: string
): Promise<void> {
  const selfId = game.user?._id
  if (!selfId) return
  const targetId = authorId ?? selfId
  const target = game.users.get(targetId)
  if (!target) return

  // A direct write to the author's own user document — no socket request, and no
  // GM/player branch. A comment is stored on whoever wrote it
  // (utils/chatComments.ts), so "only its author may rewrite it" is Foundry's
  // document permission rather than a rule this code has to check: a player
  // editing someone else's comment simply cannot write that document.
  const current = readUserComments({ flags: target.flags as Record<string, unknown> })
  const next = upsertUserComment(current, {
    id: commentId ?? uuidv4(),
    messageId,
    text,
    timestamp: Date.now()
  })
  await target.setFlag(MODULE_ID, 'comments', next)
}

function save(id: string, text: string, comment?: ChatComment): void {
  void requestComment(id, text, comment?.id, comment?.userId).catch((error) =>
    logger.warn('TABLEMATE: comment write failed', id, comment?.id, error)
  )
}

// The name a comment should read as. A sheet-only user is attached to a human's
// login user through the tablemate.belongsTo flag, so a comment written from a
// tablet reads as the human behind it — the same resolution the app and the
// origin badge use.
function commentAuthorName(userId: string): string {
  const author = game.users.get(userId)
  const ownerId = author?.getFlag?.('tablemate', 'belongsTo')
  const owner = typeof ownerId === 'string' && ownerId ? game.users.get(ownerId) : undefined
  return owner?.name ?? author?.name ?? userId
}

// Whether THIS client's user may change a given comment (their own, or any if
// they're a GM). Adding one needs no such check — anyone may comment on
// anything.
function mayModify(comment: ChatComment): boolean {
  return canModifyComment(comment, game.user._id ?? undefined, !!game.user.isGM)
}

// ── Rendering ──────────────────────────────────────────────────────────────

const COMMENT_BASE =
  'margin-top:0.35em;padding:0.15em 0 0.15em 0.5em;border-left:2px solid rgba(120,120,180,0.8);' +
  'font-size:0.9em;line-height:1.35;'

const AUTHOR_BASE =
  'display:block;font-size:0.75em;font-weight:600;letter-spacing:0.04em;' +
  'text-transform:uppercase;opacity:0.7;'

function buildComment(comment: ChatComment, onEdit: () => void): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = COMMENT_CLASS
  wrapper.dataset.commentId = comment.id
  wrapper.style.cssText = COMMENT_BASE

  const author = document.createElement('span')
  author.style.cssText = AUTHOR_BASE
  author.textContent = commentAuthorName(comment.userId)

  // textContent, never innerHTML: a comment is stored as plain text precisely so
  // it can never inject markup into the log.
  const body = document.createElement('span')
  body.style.cssText = 'display:block;white-space:pre-line;'
  body.textContent = comment.text

  wrapper.append(author, body)

  if (mayModify(comment)) {
    // Right-click, not left. A comment sits inside the message body, where a
    // left-click is how you select and copy the text someone wrote — and the
    // chat log is full of left-clickable things (inline rolls, content links)
    // that a comment should not behave differently from. Editing is the
    // secondary action, so it goes on the secondary button, which is also where
    // Foundry puts every other per-message action.
    wrapper.style.cssText += 'cursor:context-menu;'
    wrapper.title = 'Right-click to edit this comment'
    wrapper.addEventListener('contextmenu', (event) => {
      // preventDefault drops the browser's own menu; stopPropagation keeps the
      // message's Foundry context menu from opening on top of the dialog. Core
      // binds that one to the chat log with delegation, in the bubble phase
      // (ContextMenu#bind), so stopping here is enough to keep it shut.
      event.preventDefault()
      event.stopPropagation()
      onEdit()
    })
  }
  return wrapper
}

// Comments live on their AUTHOR's user document now (utils/chatComments.ts), so
// drawing a thread means collecting across users rather than reading the
// message. Cached and invalidated on `updateUser`, for the same reasons as the
// reaction index — see reactionDisplay.ts.
let commentIndex: Map<string, ChatComment[]> | null = null

function commentsOn(message: CommentableMessage, id: string): ChatComment[] {
  commentIndex ??= indexUserComments(game.users)
  const stored = commentIndex.get(id) ?? []
  // Union in anything an older app build left on the MESSAGE, so a world
  // mid-rollover shows the whole thread. Ids are unique per comment, so
  // dedup is by id and ordering stays the clock's.
  const legacy = readComments(message)
  if (!legacy.length) return stored
  const seen = new Set(stored.map((c) => c.id))
  return [...stored, ...legacy.filter((c) => !seen.has(c.id))].sort(
    (a, b) => a.timestamp - b.timestamp
  )
}

// Rebuild the comment block from the message's current flag. Wholesale rather
// than diffed — a handful of nodes, and rebuilding keeps it idempotent, which
// matters because this runs from both the render hook and the update hook. A
// message with no comments gets no container at all, so the log looks untouched
// until someone actually writes one.
export function applyCommentDisplay(message: CommentableMessage, element: HTMLElement): void {
  const id = messageId(message)
  if (!id) return

  // Clear first, THEN check the switch — same reason as the reaction row: this
  // runs again on every client when the GM turns comments off, and the notes
  // already drawn have to come off the log.
  element.querySelector<HTMLElement>(`.${CONTAINER_CLASS}`)?.remove()
  if (!commentsEnabled()) return

  const comments = commentsOn(message, id)
  if (!comments.length) return

  const container = document.createElement('div')
  container.className = CONTAINER_CLASS

  for (const comment of comments) {
    container.appendChild(buildComment(comment, () => promptForComment(id, comment)))
  }

  const host = element.querySelector<HTMLElement>('.message-content') ?? element
  host.appendChild(container)
}

// ── The editor ─────────────────────────────────────────────────────────────

// Ask for a comment's text and write it. Saving an existing comment with an
// empty box removes it, which is the same "empty text deletes" contract the wire
// has — so the dialog needs no separate delete button.
//
// DialogV2 is core's own prompt, so it inherits the world's dialog styling and
// needs no markup from us beyond the textarea.
async function promptForComment(id: string, comment?: ChatComment): Promise<void> {
  const textarea = document.createElement('textarea')
  textarea.name = 'text'
  textarea.rows = 4
  textarea.maxLength = COMMENT_MAX_LENGTH
  // textContent, not .value: DialogV2 serializes the content element (see
  // below), and a textarea's value is a property with no HTML representation —
  // set that way it serializes to an empty box, which is what an edit used to
  // open with. Its default value IS its child text, so that survives the round
  // trip. Escaping is the serializer's: text in, text out.
  textarea.textContent = comment?.text ?? ''
  textarea.style.cssText = 'width:100%;resize:vertical;'

  const content = document.createElement('div')
  content.appendChild(textarea)

  // A <div> element rather than an HTML string: core runs a string through
  // cleanHTML and takes an element's innerHTML as-is (DialogV2
  // #_initializeApplicationOptions), so the comment's text never goes near a
  // sanitizer that could rewrite what someone wrote. It is still serialized to
  // markup on the way in, which is why the textarea above carries its text as a
  // child node rather than as a property.
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: comment ? 'Edit comment' : 'Add comment' },
    content,
    // Do not throw when the user dismisses the dialog: closing is a cancel, not
    // an error, and an unhandled rejection here would surface as a Foundry error
    // toast on every dismissed prompt.
    rejectClose: false,
    ok: {
      label: 'Save',
      callback: (_event, button) => {
        const form = button.form as HTMLFormElement | null
        const field = form?.elements.namedItem('text')
        return field instanceof HTMLTextAreaElement ? field.value : ''
      }
    }
  })

  if (typeof result !== 'string') return
  const text = sanitizeCommentText(result)
  // Nothing typed on a NEW comment is a cancel; on an existing one, emptying the
  // box is how it is removed.
  if (!text && !comment) return
  save(id, text, comment)
}

// ── Right-click menu ───────────────────────────────────────────────────────

// Can this client's write actually be serviced? A GM writes the flag itself;
// anyone else needs a GM online to do it for them. Mirrors reactionsAvailable.
// The world switch is the whole question, exactly as in reactionsAvailable — a
// comment goes to its author's own user document, so no GM need be connected.
function commentsAvailable(): boolean {
  return commentsEnabled()
}

// The right-clicked message's id, from whatever the running core hands the
// callback (HTMLElement on v13+, a jQuery wrapper on older cores).
function contextTargetMessageId(target: unknown): string | undefined {
  const element = chatMessageElement(target)
  if (!element) return undefined
  return (
    element.dataset?.messageId ??
    element.closest<HTMLElement>('[data-message-id]')?.dataset.messageId
  )
}

// v14 renamed two ContextMenuEntry fields (condition → visible, name → label)
// and deprecates the old names while still reading them; v13 reads only the old
// ones. Both spellings are set, exactly as the reaction entries do — see the
// long note in reactionDisplay.ts.
type CommentContextEntry = ContextMenuEntry & {
  condition?: ContextMenuEntry['visible']
  name?: string
  callback?: (target: unknown, event?: unknown) => void
}

function commentContextEntries(): CommentContextEntry[] {
  const add = (target: unknown) => {
    const id = contextTargetMessageId(target)
    if (id) void promptForComment(id)
  }
  return [
    {
      label: 'Add comment',
      name: 'Add comment',
      icon: '<i class="fa-solid fa-comment-dots"></i>',
      group: 'tm-comments',
      // Anyone may comment on any message, so the only questions left are
      // whether the world has the feature on and whether the write can be
      // serviced. Re-evaluated on every open (unlike the entry list itself,
      // which core builds once), which is what lets it track both — neither is
      // knowable at `init`, when the entry is built.
      visible: commentsAvailable,
      condition: commentsAvailable,
      // v14 prefers onClick(event, target); v13 calls callback(target, event).
      // Separate functions, so v14's event never arrives where v13's target
      // belongs.
      onClick: (_event: PointerEvent, target: HTMLElement) => add(target),
      callback: (target: unknown) => add(target)
    }
  ]
}

// Exported for direct testing: this is the payload handling that decides whether
// the entry reaches the menu at all.
export function registerCommentContextEntries(options: unknown): void {
  if (!Array.isArray(options)) return
  // Guard against a core that somehow fires both hooks for one menu.
  if (options.some((entry) => (entry as ContextMenuEntry)?.group === 'tm-comments')) return
  options.push(...commentContextEntries())
}

// v14 fires 'getChatMessageContextOptions'; v13 fired 'getChatLogEntryContext'.
// They're version-exclusive, and the guard above covers a core that fires both.
const CONTEXT_HOOKS = ['getChatMessageContextOptions', 'getChatLogEntryContext'] as const

// Messages already in the log when this module's ready-time registration runs
// have had renderChatMessageHTML fire already, so the hook below would never see
// them. Sweep them once — same reasoning as reactionDisplay.
function sweepRenderedMessages(): void {
  const messages: Iterable<CommentableMessage> | undefined = game.messages
  if (!messages) return
  for (const message of messages) {
    const element = findRenderedChatMessage(message)
    if (element) applyCommentDisplay(message, element)
  }
}

// Redraw every message in the log when the world switch flips. Works in both
// directions: applyCommentDisplay removes the existing block before it checks
// the switch, so one sweep both adds notes and takes them away.
export function refreshCommentDisplay(): void {
  commentIndex = null
  sweepRenderedMessages()
}

export function setupCommentDisplay(): void {
  if (commentDisplayRegistered) return
  commentDisplayRegistered = true

  onHook('renderChatMessageHTML', (message: CommentableMessage, html: unknown) => {
    const element = chatMessageElement(html) ?? findRenderedChatMessage(message)
    if (element) applyCommentDisplay(message, element)
  })

  // Someone commented. Comments are stored on their author's own user, so a
  // User update — not a ChatMessage update — is the only signal this client
  // gets that a thread has changed.
  // The user collection changed. `updateUser` is the one that matters — a
  // comment is stored on its author's own user, so that is the only signal this
  // client gets that one was written — but create/delete matter too: the index
  // below is built from the whole collection, so someone joining or leaving
  // mid-session would otherwise leave it describing a table that has moved on.
  for (const hook of ['updateUser', 'createUser', 'deleteUser']) {
    onHook(hook, () => refreshCommentDisplay())
  }

  // A note is a flag-only update. Foundry normally re-renders the message (which
  // the hook above catches), but re-applying directly is cheap insurance against
  // a version or a flag-only diff that skips the re-render — without it a note
  // written from a tablet wouldn't appear here until the next reload.
  onHook('updateChatMessage', (message: CommentableMessage) => {
    const element = findRenderedChatMessage(message)
    if (element) applyCommentDisplay(message, element)
  })

  sweepRenderedMessages()
  window.requestAnimationFrame(sweepRenderedMessages)
}

// Registered from `init`, NOT `ready` — see the timing note at the top of this
// file and the longer one in reactionDisplay.ts.
export function setupCommentContextMenu(): void {
  if (commentContextMenuRegistered) return
  commentContextMenuRegistered = true

  for (const hook of CONTEXT_HOOKS) {
    Hooks.on(hook, (...args: unknown[]) => registerCommentContextEntries(args[args.length - 1]))
  }
}
