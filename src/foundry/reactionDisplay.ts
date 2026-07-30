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
// Styling is inline: the module ships no stylesheet Foundry loads (module.json
// declares only esmodules), the same reason chatOriginDisplay builds its badge
// with cssText. Colors are chosen to hold up on both the light parchment and the
// dark Foundry chat themes.

import type { ContextMenuEntry } from '@7h3laughingman/foundry-types/client/applications/ux/context-menu.mjs'
import { TM } from '@/api/protocol'
import { logger, uuidv4 } from '@/utils/utilities'
import {
  REACTION_EMOJI,
  groupReactions,
  readReactions,
  type ReactionGroup
} from '@/utils/chatReactions'
import {
  chatMessageElement,
  findRenderedChatMessage,
  type TablemateChatMessage
} from './utils/chatMessage'
import { foundryToggleReaction } from './handlers/reactions'

let reactionDisplayRegistered = false

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
  const userId = game.user._id
  if (!userId) return
  if (game.user.isGM) {
    await foundryToggleReaction({
      action: TM.TOGGLE_REACTION,
      uuid: uuidv4(),
      userId,
      messageId: id,
      emoji
    })
    return
  }
  game.socket.emit(TM.CHANNEL, {
    action: TM.TOGGLE_REACTION,
    uuid: uuidv4(),
    userId,
    messageId: id,
    emoji
  })
}

function userName(userId: string): string {
  return game.users.get(userId)?.name ?? userId
}

const CHIP_BASE =
  'display:inline-flex;align-items:center;gap:0.2em;padding:0.05em 0.4em;font-size:0.8em;' +
  'line-height:1.5;border-radius:0.8em;cursor:pointer;white-space:nowrap;' +
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

  element.querySelector<HTMLElement>(`.${CONTAINER_CLASS}`)?.remove()

  const groups = groupReactions(readReactions(message), {
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

// Can this client's reaction actually be serviced? A GM writes the flag itself;
// anyone else needs a GM online to do it for them (see requestToggle). With no
// GM connected a player's request would go unanswered, so the entries are hidden
// rather than offered as a silent no-op.
function reactionsAvailable(): boolean {
  if (game.user.isGM) return true
  return !!(game.users as unknown as { activeGM?: { id?: string } | null })?.activeGM
}

// One entry per palette emoji, in a group of their own so they read as a block
// and sort away from Foundry's own entries. Each toggles, so picking an emoji you
// already gave removes it — the same operation as clicking its chip.
//
// The entries are built once per ChatLog render, not per right-click, so they
// can't show which emoji you've already given on the message under the cursor —
// only `callback` and `condition` receive the target element. That's what the
// chips are for; the menu is the entry point, not the state display.
function reactionContextEntries(): ContextMenuEntry[] {
  return REACTION_EMOJI.map((emoji) => ({
    name: emoji,
    group: 'tm-reactions',
    condition: reactionsAvailable,
    callback: (target: unknown) => {
      const id = contextTargetMessageId(target)
      if (id) toggle(id, emoji)
    }
  }))
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

// Foundry v13 renamed the sidebar context hooks (getChatLogEntryContext →
// getChatMessageContextOptions). The module targets v13+, but both names are
// registered because they're version-exclusive — whichever the running core
// fires, the entries land, and neither can double up.
const CONTEXT_HOOKS = ['getChatMessageContextOptions', 'getChatLogEntryContext'] as const

function registerContextEntries(options: unknown): void {
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
  const messages = game.messages as unknown as Iterable<ReactableMessage> | undefined
  if (!messages) return
  for (const message of messages) {
    const element = findRenderedChatMessage(message)
    if (element) applyReactionDisplay(message, element)
  }
}

export function setupReactionDisplay(): void {
  if (reactionDisplayRegistered) return
  reactionDisplayRegistered = true

  Hooks.on('renderChatMessageHTML', (message: ReactableMessage, html: unknown) => {
    const element = chatMessageElement(html) ?? findRenderedChatMessage(message)
    if (element) applyReactionDisplay(message, element)
  })

  // A reaction is a flag-only update. Foundry normally re-renders the message
  // (which the hook above catches), but re-applying directly is cheap insurance
  // against a version or a flag-only diff that skips the re-render — without it
  // a chip added from a tablet wouldn't appear here until the next reload.
  Hooks.on('updateChatMessage', (message: ReactableMessage) => {
    const element = findRenderedChatMessage(message)
    if (element) applyReactionDisplay(message, element)
  })

  // Add the palette to the message's own right-click menu — the only way to give
  // a message its FIRST reaction, now that nothing is rendered until one exists.
  for (const hook of CONTEXT_HOOKS) {
    Hooks.on(hook, (...args: unknown[]) => registerContextEntries(args[args.length - 1]))
  }

  sweepRenderedMessages()
  window.requestAnimationFrame(sweepRenderedMessages)
}
