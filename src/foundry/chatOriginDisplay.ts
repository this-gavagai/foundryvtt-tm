// Rewrites the author shown on a rendered chat message to the Tablemate origin
// user that actually triggered it, so a GM-proxied roll reads as the player's.
// Pairs with the Foundry-side stamping in listener.ts (setupChatOriginStamping).

import {
  chatMessageElement,
  findRenderedChatMessage,
  type TablemateChatMessage
} from './utils/chatMessage'
import { tablemateChatOriginUserId, tablemateManualRoll } from './utils/foundry'

let chatOriginDisplayRegistered = false

// Under the 'flag' manual-roll policy, messages whose dice faces were supplied
// by the player carry flags.tablemate.manualRoll — surface that as a small tag
// next to the sender so the GM can tell at a glance. The badge is appended
// INSIDE h4.message-sender (inline with the name) rather than as a header
// sibling: the header is a wrapping flex row, so a sibling becomes its own
// flex item and lands on a wrapped line next to the flavor text. Must run
// after the origin rename above — sender.textContent assignment replaces the
// h4's children. Idempotent: the retry patching below calls this repeatedly
// on the same element.
function applyManualRollBadge(message: TablemateChatMessage, element: HTMLElement) {
  if (!tablemateManualRoll(message)) return
  if (element.querySelector('.tm-manual-roll-badge')) return
  const sender =
    element.querySelector<HTMLElement>('.message-header .message-sender') ??
    element.querySelector<HTMLElement>('.message-sender')
  if (!sender) return
  const badge = document.createElement('span')
  badge.className = 'tm-manual-roll-badge'
  badge.title = 'Dice result supplied by the player (manual face picker or Pixel dice)'
  // A solid white chip with black die + text (rather than currentColor at
  // reduced opacity) so the tag stays high-contrast on both the parchment
  // and dark Foundry chat themes. The die is Foundry's bundled FontAwesome
  // d20 — the 🎲 emoji rendered in platform colors and read as noise.
  badge.style.cssText =
    'margin-left:0.35em;padding:0.1em 0.45em;font-size:0.7em;font-weight:600;' +
    'vertical-align:middle;color:#000;background:#fff;border:1px solid rgba(0,0,0,0.5);' +
    'border-radius:0.6em;box-shadow:0 1px 2px rgba(0,0,0,0.25);white-space:nowrap;'
  const die = document.createElement('i')
  die.className = 'fa-solid fa-dice-d20'
  die.style.marginRight = '0.3em'
  badge.append(die, 'manual')
  sender.appendChild(badge)
}

function applyChatOriginDisplay(
  message: TablemateChatMessage,
  originUserId: string,
  element: HTMLElement
) {
  const originName = game.users.get(originUserId)?.name ?? originUserId
  const header = element.querySelector<HTMLElement>('.message-header')

  const sender =
    header?.querySelector<HTMLElement>('.message-sender') ??
    header?.querySelector<HTMLElement>('h4') ??
    element.querySelector<HTMLElement>('.message-sender')
  const authorName = message.author?.name
  if (sender && authorName && sender.textContent?.trim() === authorName) {
    sender.textContent = originName
    sender.title = `${originName} via Tablemate`
  }

  const pf2eUser = header?.querySelector<HTMLElement>('.user')
  if (pf2eUser) {
    pf2eUser.textContent = originName
    pf2eUser.title = `${originName} via Tablemate`
  }

  applyManualRollBadge(message, element)
}

function patchRenderedChatOrigin(message: TablemateChatMessage) {
  const originUserId = tablemateChatOriginUserId(message)
  if (!originUserId) return

  const patch = () => {
    const element = findRenderedChatMessage(message)
    if (element) applyChatOriginDisplay(message, originUserId, element)
  }
  patch()
  window.requestAnimationFrame(patch)
  window.setTimeout(patch, 50)
  window.setTimeout(patch, 250)
}

export function setupChatOriginDisplay() {
  if (chatOriginDisplayRegistered) return
  chatOriginDisplayRegistered = true

  Hooks.on('renderChatMessageHTML', (message: TablemateChatMessage, html: unknown) => {
    const originUserId = tablemateChatOriginUserId(message)
    if (!originUserId) return

    const element = chatMessageElement(html) ?? findRenderedChatMessage(message)
    if (element) applyChatOriginDisplay(message, originUserId, element)

    window.requestAnimationFrame(() => {
      const rendered = findRenderedChatMessage(message)
      if (rendered) applyChatOriginDisplay(message, originUserId, rendered)
    })
  })
  Hooks.on('createChatMessage', (message: TablemateChatMessage) => {
    patchRenderedChatOrigin(message)
  })
  Hooks.on('updateChatMessage', (message: TablemateChatMessage) => {
    patchRenderedChatOrigin(message)
  })
}
