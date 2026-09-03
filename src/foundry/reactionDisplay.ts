// Renders emoji reactions into the Foundry chat log, and lets a Foundry-client
// user add their own.
//
// Reactions are a Tablemate concept stored in flags.tablemate.reactions (see
// utils/chatReactions.ts), so the desktop chat log knows nothing about them.
// Without this, a reaction added from a tablet would be invisible to everyone
// sitting at the actual Foundry client.
//
// A message with no reactions renders NOTHING — no chips, no add button. The
// only entry point for a first reaction is the message's right-click menu, so
// the log stays exactly as uncluttered as it was before this feature existed.
// Once a message has reactions, its chips are clickable to toggle your own.
//
// The right-click path extends Foundry's OWN context menu (via the
// _getEntryContextOptions hook) rather than listening for `contextmenu`
// ourselves. A listener would have to preventDefault to show a custom palette,
// which would suppress Foundry's native entries — losing "Delete", "Reveal to
// Everyone", and everything the system and other modules add.
//
// TIMING, and it is load-bearing: ChatLog builds its context menu ONCE, in
// _onFirstRender, and ContextMenu captures that entry array for its lifetime
// (`this.menuItems = menuItems`) — it never re-asks the application. Core renders
// the UI (game.mjs initializeUI) BEFORE it fires `ready`, so a module that
// registers this hook at ready has already missed the only time it fires, and no
// reaction entries ever appear. setupReactionContextMenu must therefore be called
// from `init`; only the per-message render hooks can wait for ready.
//
// Styling is inline: the module ships no stylesheet Foundry loads (module.json
// declares only esmodules — and the emitted tablemate.css belongs to the
// sheet-redirect page, which hides the entire UI, so it must NOT be declared as
// one), the same reason chatOriginDisplay builds its badge with cssText. Colors
// are chosen to hold up on both the light parchment and the dark Foundry chat
// themes. The one exception is the context-menu row layout, which can't be done
// with inline styles because we don't create those elements — see
// REACTION_MENU_STYLE.

import type { ContextMenuEntry } from '@7h3laughingman/foundry-types/client/applications/ux/context-menu.mjs'
import { MODULE_ID } from '@/api/protocol'
import { logger } from '@/utils/utilities'
import {
  REACTION_EMOJI,
  groupReactions,
  indexUserReactions,
  readReactions,
  readUserReactions,
  toggleUserReaction,
  type ChatReaction,
  type ReactionGroup
} from '@/utils/chatReactions'
import {
  chatMessageElement,
  findRenderedChatMessage,
  type TablemateChatMessage
} from './utils/chatMessage'
import { reactionsEnabled } from './featureToggles'
import { onHook } from './globals'

let reactionDisplayRegistered = false
let reactionContextMenuRegistered = false

const CONTAINER_CLASS = 'tm-reactions'
const CHIP_CLASS = 'tm-reaction-chip'

// The module's shared chat-message shape already covers what's needed here: the
// id, and the reaction flag in whichever access shape Foundry hands us.
type ReactableMessage = TablemateChatMessage

function messageId(message: ReactableMessage): string | undefined {
  return message?.id ?? message?._id ?? undefined
}

// Ask for a reaction toggle. A GM can write the flag itself, so it runs the
// handler locally — the socket doesn't echo an emit back to its sender, so a
// lone GM emitting would never be answered. Everyone else goes over the wire to
// the first active GM, exactly as the app does: they lack permission to update
// another user's message directly.
//
// The local call sidesteps the listener's dispatch chain, so a GM clicking a chip
// in the very millisecond a tablet's request is mid-flight could lose one of the
// two toggles (both are read-modify-write on the same flag). Left as-is: the
// window is a single click against a concurrent tap, and the loser simply taps
// again — worth less than plumbing a click through the socket to itself.
async function requestToggle(id: string, emoji: string): Promise<void> {
  const user = game.user
  const userId = user?._id
  if (!userId) return
  // A direct write to our OWN user document — no socket request, and no
  // GM/player branch, because a reaction is stored on the reactor rather than on
  // the message (utils/chatReactions.ts) and Foundry lets a user write
  // themselves. setFlag rather than a raw update so the change goes through the
  // normal document lifecycle and reaches every client, this one included.
  //
  // The read-modify-write race the RPC version had is gone with it: this list
  // has exactly one writer, so two people reacting at the same instant cannot
  // lose a toggle any more.
  const current = readUserReactions({ _id: userId, flags: user.flags as Record<string, unknown> })
  await user.setFlag(MODULE_ID, 'reactions', toggleUserReaction(current, id, emoji))
}

function userName(userId: string): string {
  return game.users.get(userId)?.name ?? userId
}

// Reactions live on their AUTHOR's user document now (utils/chatReactions.ts),
// so drawing them means looking across users rather than at the message.
//
// Cached, because this runs per rendered message: rebuilding the index for each
// row would rescan every user's whole reaction history a few hundred times on
// one log render. Invalidated by the `updateUser` hook below, which is also what
// makes someone else's reaction appear here without a reload.
let reactionIndex: Map<string, ChatReaction[]> | null = null

function reactionsOn(message: ReactableMessage, id: string): ChatReaction[] {
  reactionIndex ??= indexUserReactions(game.users)
  const stored = reactionIndex.get(id) ?? []
  // Union in anything an older app build left on the MESSAGE, so a world
  // mid-rollover shows all its reactions rather than half of them.
  const legacy = readReactions(message)
  if (!legacy.length) return stored
  const seen = new Set(stored.map((r) => `${r.emoji}|${r.userId}`))
  return [...stored, ...legacy.filter((r) => !seen.has(`${r.emoji}|${r.userId}`))]
}

// user-select:none because a chip is a toggle, not text — a double-click aimed at
// it would otherwise select "👍 3" instead of just reacting.
const CHIP_BASE =
  'display:inline-flex;align-items:center;gap:0.2em;padding:0.05em 0.4em;font-size:0.8em;' +
  'line-height:1.5;border-radius:0.8em;cursor:pointer;white-space:nowrap;user-select:none;' +
  'background:rgba(255,255,255,0.9);border:1px solid rgba(0,0,0,0.35);color:#000;'

function buildChip(group: ReactionGroup, onClick: () => void): HTMLElement {
  const chip = document.createElement('button')
  chip.type = 'button'
  chip.className = CHIP_CLASS
  // A reacted-by-me chip gets a filled border + tint so it reads as a toggle
  // that's currently on, matching the app's chip styling.
  chip.style.cssText =
    CHIP_BASE + (group.mine ? 'border-color:#1d4ed8;background:#dbeafe;font-weight:600;' : '')
  chip.title = `${group.emoji} ${group.names.join(', ')}`
  chip.setAttribute('aria-label', chip.title)
  chip.append(group.emoji, ` ${group.count}`)
  chip.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    onClick()
  })
  return chip
}

// Fire a toggle and log a failure — the shared tail of the chip click and the
// context-menu entries.
function toggle(id: string, emoji: string): void {
  void requestToggle(id, emoji).catch((error) =>
    logger.warn('TABLEMATE: reaction toggle failed', id, emoji, error)
  )
}

// Rebuild the reaction row from the message's current flag. Wholesale rather
// than diffed — the row is a handful of nodes, and rebuilding keeps it
// idempotent, which matters because this is called from both the render hook and
// the update hook.
//
// A message with no reactions gets no container at all, so the log looks
// untouched until someone actually reacts. That's also why removing the last
// reaction has to delete the leftover container rather than leave an empty one.
export function applyReactionDisplay(message: ReactableMessage, element: HTMLElement): void {
  const id = messageId(message)
  if (!id) return

  // Clear first, THEN check the switch: this runs again on every client when the
  // GM turns reactions off (see refreshReactionDisplay), and the chips already
  // drawn have to come off the log rather than freeze in place.
  element.querySelector<HTMLElement>(`.${CONTAINER_CLASS}`)?.remove()
  if (!reactionsEnabled()) return

  const groups = groupReactions(reactionsOn(message, id), {
    selfUserId: game.user._id,
    nameFor: userName
  })
  if (!groups.length) return

  const container = document.createElement('div')
  container.className = CONTAINER_CLASS
  container.style.cssText =
    'display:flex;align-items:center;gap:0.25em;flex-wrap:wrap;margin-top:0.35em;'

  for (const group of groups) {
    container.appendChild(buildChip(group, () => toggle(id, group.emoji)))
  }

  // Append below the message body. `.message-content` is core Foundry's
  // container for the rendered content; fall back to the message element itself
  // on a layout that doesn't have it.
  const host = element.querySelector<HTMLElement>('.message-content') ?? element
  host.appendChild(container)
}

// ── Right-click menu ───────────────────────────────────────────────────────

// Can this client's reaction actually be serviced?
//
// The world switch is now the whole question. It used to also require a GM
// online for a player, because a reaction was a write to someone else's message
// that only a GM could perform — with none connected the request went
// unanswered, so the entries were hidden rather than offered as a silent no-op.
// A reaction is written to the reactor's OWN user document now (requestToggle),
// which every client may do, so there is nothing left to wait for.
function reactionsAvailable(): boolean {
  return reactionsEnabled()
}

// v14 renamed two ContextMenuEntry fields and deprecates the old names:
// condition → visible, and name → label. Both spellings of each are still set
// below so v13 (which reads the old names) and v14 (which prefers the new ones,
// and only warns when it sees an old name WITHOUT its replacement) are each
// satisfied without a console deprecation. Confirmed in 14.367:
//
//     const visibilityCheck = "visible" in entry ? entry.visible : entry.condition
//
// The types now describe v14, so it is the LEGACY pair that has to be declared
// here — the reverse of what this augmentation held against the v13 types.
type ReactionContextEntry = ContextMenuEntry & {
  condition?: ContextMenuEntry['visible']
  name?: string
  callback?: (target: unknown, event?: unknown) => void
}

// One entry per palette emoji, in a group of their own so they read as a block
// and sort away from Foundry's own entries. Each toggles, so picking an emoji you
// already gave removes it — the same operation as clicking its chip.
//
// The entry list is built once (see the timing note up top), so it can't show
// which emoji you've already given on the message under the cursor — only
// `callback` and the visibility check receive the target element. That's what the
// chips are for; the menu is the entry point, not the state display. Visibility
// IS re-evaluated on every open, which is what lets reactionsAvailable() reflect
// whether a GM is online right now.
function reactionContextEntries(): ReactionContextEntry[] {
  return REACTION_EMOJI.map((emoji) => {
    const react = (target: unknown) => {
      const id = contextTargetMessageId(target)
      if (id) toggle(id, emoji)
    }
    return {
      label: emoji,
      name: emoji,
      group: 'tm-reactions',
      visible: reactionsAvailable,
      condition: reactionsAvailable,
      // The third v14 rename, and the only one that is not a straight alias:
      // onClick takes (event, target) where callback took (target, event). v14
      // prefers onClick and falls back to callback with a deprecation warning
      // (foundry.mjs:29614), so both are supplied — as separate functions,
      // because handing the same one to both would feed v14's event in where
      // v13's target belongs.
      onClick: (_event: PointerEvent, target: HTMLElement) => react(target),
      callback: (target: unknown) => react(target)
    }
  })
}

// The right-clicked message's id, from whatever the running core hands the
// callback: v13 passes an HTMLElement, older cores passed a jQuery wrapper, and
// chatMessageElement normalizes both. Resolved through `closest` as well as a
// direct dataset read, so a target that arrives as an inner node still finds the
// message it belongs to.
function contextTargetMessageId(target: unknown): string | undefined {
  const element = chatMessageElement(target)
  if (!element) return undefined
  return (
    element.dataset?.messageId ??
    element.closest<HTMLElement>('[data-message-id]')?.dataset.messageId
  )
}

// v14's ChatLog calls _createContextMenu with hookName 'getChatMessageContextOptions'
// and parentClassHooks:false, so that exact name fires once, with the entry array
// as its last argument (verified against core). Core's older ContextMenu.create
// path instead builds `get<ClassName><hookName>` from a default hookName of
// 'EntryContext' — i.e. getChatLogEntryContext — which is what v13 used. The
// module supports v13+, so both are registered; they're version-exclusive, and
// registerContextEntries guards against a double-add regardless.
const CONTEXT_HOOKS = ['getChatMessageContextOptions', 'getChatLogEntryContext'] as const

// Lay the palette out as ONE row rather than six stacked menu rows.
//
// Purely presentational, and it can be pure CSS because core wraps each entry
// group in its own element: `<li class="context-group" data-group-id="tm-reactions">
// <ol>…entries…</ol></li>`. The group id is ours, so the selector can't reach
// another module's entries or core's own.
//
// A <style> tag rather than inline styles because these elements are built by
// core, not by us — there is nothing of ours to set a style attribute on. Scoped
// tightly enough that it needs no !important.
const REACTION_MENU_STYLE_ID = 'tm-reaction-menu-style'
const REACTION_MENU_STYLE = `
/* Core separates groups with a border-BOTTOM on every group but the last
   (#context-menu li.context-group), which puts the rule between the palette and
   the "Add comment" entry that follows it — the two module entries that belong
   together, split apart from Foundry's own. Move the line to the top of the
   palette so it divides core's entries from ours instead.

   These two carry #context-menu, unlike the layout rules below: core's
   :last-child reset is #context-menu li.context-group:last-child, and matching
   its specificity is what keeps the line when the palette is the last group
   (comments off, or unavailable). At equal specificity this sheet wins on
   order, being appended to head long after core's. */
#context-menu li.context-group[data-group-id='tm-reactions'] {
  border-top: 1px solid var(--group-separator);
  border-bottom: none;
}

li.context-group[data-group-id='tm-reactions'] > ol {
  display: flex;
  flex-wrap: nowrap;
  gap: 0.125em;
}
li.context-group[data-group-id='tm-reactions'] > ol > li.context-item {
  flex: 1 0 auto;
  justify-content: center;
  text-align: center;
  padding-inline: 0.35em;
  user-select: none;
}
li.context-group[data-group-id='tm-reactions'] > ol > li.context-item > span {
  font-size: 1.1em;
}
`

function injectReactionMenuStyle(): void {
  if (document.getElementById(REACTION_MENU_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = REACTION_MENU_STYLE_ID
  style.textContent = REACTION_MENU_STYLE
  document.head.appendChild(style)
}

// Exported for direct testing: this is the payload handling that decides whether
// any reaction entry reaches the menu at all.
export function registerContextEntries(options: unknown): void {
  if (!Array.isArray(options)) return
  // Guard against a core that somehow fires both hooks for one menu.
  if (options.some((entry) => (entry as ContextMenuEntry)?.group === 'tm-reactions')) return
  options.push(...reactionContextEntries())
}

// Messages already in the log when this module's ready-time registration runs
// have had renderChatMessageHTML fire already, so the hook below would never see
// them (a reload posts nothing new). Sweep them once — same reasoning as
// chatOriginDisplay.sweepRenderedMessages.
function sweepRenderedMessages(): void {
  const messages: Iterable<ReactableMessage> | undefined = game.messages
  if (!messages) return
  for (const message of messages) {
    const element = findRenderedChatMessage(message)
    if (element) applyReactionDisplay(message, element)
  }
}

// Redraw every message in the log. Called when the world switch flips, in both
// directions: applyReactionDisplay removes the existing row before it checks the
// switch, so one sweep both adds chips and takes them away.
export function refreshReactionDisplay(): void {
  reactionIndex = null
  sweepRenderedMessages()
}

export function setupReactionDisplay(): void {
  if (reactionDisplayRegistered) return
  reactionDisplayRegistered = true

  onHook('renderChatMessageHTML', (message: ReactableMessage, html: unknown) => {
    const element = chatMessageElement(html) ?? findRenderedChatMessage(message)
    if (element) applyReactionDisplay(message, element)
  })

  // Someone reacted. Reactions are stored on the reactor's own user, so this is
  // the only hook that hears about one — a User update, not a ChatMessage
  // update. Without it the log would only ever show reactions made on this
  // client, and only until the next reload.
  // The user collection changed. `updateUser` is the one that matters — a
  // reaction is stored on its author's own user, so that is the only signal this
  // client gets that one was written — but create/delete matter too: the index
  // below is built from the whole collection, so someone joining or leaving
  // mid-session would otherwise leave it describing a table that has moved on.
  for (const hook of ['updateUser', 'createUser', 'deleteUser']) {
    onHook(hook, () => refreshReactionDisplay())
  }

  // A reaction is a flag-only update. Foundry normally re-renders the message
  // (which the hook above catches), but re-applying directly is cheap insurance
  // against a version or a flag-only diff that skips the re-render — without it
  // a chip added from a tablet wouldn't appear here until the next reload.
  onHook('updateChatMessage', (message: ReactableMessage) => {
    const element = findRenderedChatMessage(message)
    if (element) applyReactionDisplay(message, element)
  })

  sweepRenderedMessages()
  window.requestAnimationFrame(sweepRenderedMessages)
}

// Registered from `init`, NOT `ready` — see the timing note at the top of this
// file. By the time `ready` fires, ChatLog has already built its context menu
// from whatever entries existed then, and it never rebuilds.
export function setupReactionContextMenu(): void {
  if (reactionContextMenuRegistered) return
  reactionContextMenuRegistered = true

  injectReactionMenuStyle()
  for (const hook of CONTEXT_HOOKS) {
    Hooks.on(hook, (...args: unknown[]) => registerContextEntries(args[args.length - 1]))
  }
}
