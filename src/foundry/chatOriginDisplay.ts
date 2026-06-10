// Rewrites the author shown on a rendered chat message to the Tablemate origin
// user that actually triggered it, so a GM-proxied roll reads as the player's.
// Pairs with the Foundry-side stamping in listener.ts (setupChatOriginStamping).

import {
  chatMessageElement,
  findRenderedChatMessage,
  type TablemateChatMessage
} from './utils/chatMessage'
import { tablemateChatOriginUserId } from './utils/foundry'

let chatOriginDisplayRegistered = false

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
