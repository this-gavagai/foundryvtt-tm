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
// next to the sender so the GM can tell at a glance. Idempotent: the retry
// patching below calls this repeatedly on the same element.
function applyManualRollBadge(message: TablemateChatMessage, element: HTMLElement) {
  if (!tablemateManualRoll(message)) return
  if (element.querySelector('.tm-manual-roll-badge')) return
  const sender =
    element.querySelector<HTMLElement>('.message-header .message-sender') ??
    element.querySelector<HTMLElement>('.message-sender')
  if (!sender) return
  const badge = document.createElement('span')
  badge.className = 'tm-manual-roll-badge'
  badge.textContent = '🎲 manual'
  badge.title = 'Dice result supplied by the player (manual face picker or Pixel dice)'
  badge.style.cssText =
    'margin-left:0.35em;padding:0 0.35em;font-size:0.7em;font-weight:normal;' +
    'border:1px solid currentColor;border-radius:0.5em;opacity:0.7;white-space:nowrap;'
  sender.insertAdjacentElement('afterend', badge)
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
