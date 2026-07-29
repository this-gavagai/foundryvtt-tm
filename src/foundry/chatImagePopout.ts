// Wires a click on a Tablemate chat image (posted by foundrySendImage inside a
// [data-tablemate-image] wrapper) to open Foundry's built-in ImagePopout — the
// same window journals/tiles use, which for a GM carries the "Show to All
// Players" share button. Runs on every Foundry client's chat render, so each
// player gets their own popout on click.

import {
  chatMessageElement,
  findRenderedChatMessage,
  type TablemateChatMessage
} from './utils/chatMessage'

type ImagePopoutMessage = {
  id?: string | null
  _id?: string | null
  speaker?: { alias?: string | null } | null
  author?: { name?: string | null } | null
  flags?: { tablemate?: { imagePath?: string | null } } | null
  getFlag?: (scope: string, key: string) => unknown
}

let chatImagePopoutRegistered = false

// The uploaded image's data-relative path from the tablemate flag, if present.
function tablemateImagePath(message: ImagePopoutMessage): string | undefined {
  const flagged = message.getFlag?.('tablemate', 'imagePath')
  const path =
    (typeof flagged === 'string' ? flagged : undefined) ??
    message.flags?.tablemate?.imagePath ??
    undefined
  return path || undefined
}

// Resolve Foundry's ImagePopout across versions: v13 nests it under
// foundry.applications.apps; v11/v12 expose it as a bare global. The two take
// different constructor shapes (v13 an options object, v12 positional src), so
// open through whichever exists.
function openImagePopout(src: string, title: string): void {
  const scope = globalThis as {
    foundry?: { applications?: { apps?: { ImagePopout?: unknown } } }
    ImagePopout?: unknown
  }
  const V13 = scope.foundry?.applications?.apps?.ImagePopout as
    | (new (options: object) => { render: (force?: boolean) => unknown })
    | undefined
  if (V13) {
    new V13({ src, window: { title }, shareable: true }).render(true)
    return
  }
  const Legacy = scope.ImagePopout as
    | (new (src: string, options: object) => { render: (force?: boolean) => unknown })
    | undefined
  if (Legacy) {
    new Legacy(src, { title, shareable: true }).render(true)
    return
  }
  // No popout class (unexpected): fall back to opening the file directly.
  window.open(src, '_blank', 'noreferrer')
}

function wireImagePopout(message: ImagePopoutMessage, element: HTMLElement): void {
  const img = element.querySelector<HTMLImageElement>('[data-tablemate-image] img')
  if (!img || img.dataset.tmPopoutWired) return
  img.dataset.tmPopoutWired = 'true'

  // Prefer the canonical flag path; fall back to the rendered src (already
  // resolved to an absolute URL by the browser).
  const src = tablemateImagePath(message) ?? img.src
  const title = message.speaker?.alias || message.author?.name || 'Image'

  img.style.cursor = 'pointer'
  img.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    openImagePopout(src, title)
  })
}

export function setupChatImagePopout(): void {
  if (chatImagePopoutRegistered) return
  chatImagePopoutRegistered = true

  Hooks.on('renderChatMessageHTML', (message: ImagePopoutMessage, html: unknown) => {
    if (!tablemateImagePath(message)) return
    // The fallback only reads id/_id off the message; cast to the shared type.
    const element =
      chatMessageElement(html) ?? findRenderedChatMessage(message as TablemateChatMessage)
    if (element) wireImagePopout(message, element)
  })
}
