// Renders emoji reactions into the Foundry chat log, and lets a Foundry-client
// user add their own.
//
// Reactions are a Tablemate concept stored in flags.tablemate.reactions (see
// utils/chatReactions.ts), so the desktop chat log knows nothing about them.
// Without this, a reaction added from a tablet would be invisible to everyone
// sitting at the actual Foundry client.
//
// Styling is inline: the module ships no stylesheet Foundry loads (module.json
// declares only esmodules), the same reason chatOriginDisplay builds its badge
// with cssText. Colors are chosen to hold up on both the light parchment and the
// dark Foundry chat themes.

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
const PALETTE_CLASS = 'tm-reaction-palette'
const OPEN_ATTR = 'data-tm-palette-open'

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

function buildPalette(onPick: (emoji: string) => void): HTMLElement {
  const palette = document.createElement('div')
  palette.className = PALETTE_CLASS
  palette.style.cssText = 'display:flex;gap:0.15em;flex-wrap:wrap;'
  for (const emoji of REACTION_EMOJI) {
    const button = document.createElement('button')
    button.type = 'button'
    button.style.cssText = CHIP_BASE
    button.title = `React with ${emoji}`
    button.setAttribute('aria-label', button.title)
    button.textContent = emoji
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      onPick(emoji)
    })
    palette.appendChild(button)
  }
  return palette
}

// Rebuild the reaction row from the message's current flag. Wholesale rather
// than diffed — the row is a handful of nodes, and rebuilding keeps it
// idempotent, which matters because this is called from both the render hook and
// the update hook. The palette's open state is carried across the rebuild so an
// unrelated message update doesn't snap it shut mid-choice.
export function applyReactionDisplay(message: ReactableMessage, element: HTMLElement): void {
  const id = messageId(message)
  if (!id) return

  const previous = element.querySelector<HTMLElement>(`.${CONTAINER_CLASS}`)
  const wasOpen = previous?.getAttribute(OPEN_ATTR) === 'true'
  previous?.remove()

  const groups = groupReactions(readReactions(message), {
    selfUserId: game.user._id,
    nameFor: userName
  })

  const container = document.createElement('div')
  container.className = CONTAINER_CLASS
  container.style.cssText =
    'display:flex;align-items:center;gap:0.25em;flex-wrap:wrap;margin-top:0.35em;'
  if (wasOpen) container.setAttribute(OPEN_ATTR, 'true')

  const toggle = (emoji: string) => {
    void requestToggle(id, emoji).catch((error) =>
      logger.warn('TABLEMATE: reaction toggle failed', id, emoji, error)
    )
  }

  for (const group of groups) container.appendChild(buildChip(group, () => toggle(group.emoji)))

  // The "add" affordance. Rendered after the chips so the row reads
  // chips-then-plus, and always present so a message with no reactions yet can
  // still get its first one.
  const add = document.createElement('button')
  add.type = 'button'
  add.style.cssText = CHIP_BASE + 'opacity:0.75;'
  add.title = 'Add reaction'
  add.setAttribute('aria-label', add.title)
  add.textContent = '☺+'
  const palette = buildPalette((emoji) => {
    container.setAttribute(OPEN_ATTR, 'false')
    palette.style.display = 'none'
    toggle(emoji)
  })
  palette.style.display = wasOpen ? 'flex' : 'none'
  add.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    const open = palette.style.display === 'none'
    palette.style.display = open ? 'flex' : 'none'
    container.setAttribute(OPEN_ATTR, String(open))
  })
  container.append(add, palette)

  // Append below the message body. `.message-content` is core Foundry's
  // container for the rendered content; fall back to the message element itself
  // on a layout that doesn't have it.
  const host = element.querySelector<HTMLElement>('.message-content') ?? element
  host.appendChild(container)
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

  sweepRenderedMessages()
  window.requestAnimationFrame(sweepRenderedMessages)
}
