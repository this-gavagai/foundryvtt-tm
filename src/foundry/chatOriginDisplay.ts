// Rewrites the author shown on a rendered chat message to the Tablemate origin
// user that actually triggered it, so a GM-proxied roll — or a message posted
// from a sheet-only user — reads as the owning player.
// Pairs with the Foundry-side stamping in listener.ts (setupChatOriginStamping).

import {
  chatMessageElement,
  findRenderedChatMessage,
  type TablemateChatMessage
} from './utils/chatMessage'
import { tablemateChatOriginUserId, tablemateManualRoll } from './utils/foundry'
import { onHook } from './globals'

let chatOriginDisplayRegistered = false

// Under the 'flag' manual-roll policy, messages whose dice faces were supplied
// by the player carry flags.tablemate.manualRoll — surface that as a small tag
// next to the sender so the GM can tell at a glance. The badge is appended
// INSIDE h4.message-sender (inline with the name) rather than as a header
// sibling: the header is a wrapping flex row, so a sibling becomes its own
// flex item and lands on a wrapped line next to the flavor text. Must run
// after the origin rename above — sender.textContent assignment replaces the
// h4's children. Idempotent: the observer below calls this repeatedly on the
// same element.
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

// The name a Tablemate-origin message should read as: a sheet-only user is
// attached to a human's primary login user via the tablemate.belongsTo flag, so
// attribute the message to that human ("Otro") rather than the sheet user
// ("Sheet"). Falls back to the origin user itself when there's no owner.
function chatOriginName(originUserId: string): string {
  const originUser = game.users.get(originUserId)
  const ownerId = originUser?.getFlag?.('tablemate', 'belongsTo')
  const ownerUser = typeof ownerId === 'string' && ownerId ? game.users.get(ownerId) : undefined
  return ownerUser?.name ?? originUser?.name ?? originUserId
}

function applyChatOriginDisplay(
  message: TablemateChatMessage,
  originUserId: string,
  element: HTMLElement
) {
  const originName = chatOriginName(originUserId)
  const header = element.querySelector<HTMLElement>('.message-header')

  // The sender heading. For an in-character message this is the character name
  // (the speaker alias), which we deliberately leave alone — only rename it when
  // it's showing the raw author name (e.g. an out-of-character message whose
  // alias fell back to the author's user name).
  const sender =
    header?.querySelector<HTMLElement>('.message-sender') ??
    header?.querySelector<HTMLElement>('h4') ??
    element.querySelector<HTMLElement>('.message-sender')
  const authorName = message.author?.name
  if (sender && authorName && sender.textContent?.trim() === authorName) {
    sender.textContent = originName
    sender.title = `${originName} via Tabula`
  }

  // PF2e appends a `.user` byline (the author's user name) under the sender for
  // in-character messages. Rewrite it to the owning player. The !== guard keeps
  // the write idempotent so the observer below doesn't loop on its own mutation.
  const pf2eUser = header?.querySelector<HTMLElement>('.user')
  if (pf2eUser && pf2eUser.textContent?.trim() !== originName) {
    pf2eUser.textContent = originName
    pf2eUser.title = `${originName} via Tabula`
  }

  applyManualRollBadge(message, element)
}

// PF2e's ChatMessagePF2e#renderHTML appends the portrait and the `.user` byline
// to the header AFTER core fires the renderChatMessageHTML hook (it runs in the
// continuation of `await super.renderHTML()`), so the byline isn't in the DOM
// when our hook first runs. A live post used to paper over this via the
// createChatMessage retry timers, but on reload no create hook fires and the
// message rendered showing the sheet user again. Rather than race PF2e with
// fixed timers, observe the header — the very element PF2e mutates — and
// re-apply whenever it changes, until the byline reads as the origin/owner.
function observeChatOriginByline(
  message: TablemateChatMessage,
  originUserId: string,
  element: HTMLElement
) {
  const header = element.querySelector<HTMLElement>('.message-header') ?? element
  const originName = chatOriginName(originUserId)
  const observer = new MutationObserver(() => {
    const userEl = header.querySelector<HTMLElement>('.user')
    // Skip when the byline is already correct (including our own edit) so
    // setting textContent doesn't retrigger the observer into a loop.
    if (userEl && userEl.textContent?.trim() === originName) return
    applyChatOriginDisplay(message, originUserId, element)
  })
  observer.observe(header, { childList: true, subtree: true, characterData: true })
  // PF2e's injection is synchronous right after its super() await, so a short
  // window suffices; disconnect so we don't leak an observer per reloaded
  // message on a long chat log.
  window.setTimeout(() => observer.disconnect(), 3000)
}

// Messages already in the log rendered during Foundry startup, BEFORE this
// module's ready-time hook registration — so renderChatMessageHTML already
// fired for them and our listener missed it. (A reload posts no new messages,
// so the hook would never run for them and they'd show the sheet user.) Sweep
// the already-rendered messages and attribute them now; the hook below covers
// everything rendered after this point (new posts, updates, lazy-loaded
// history).
function sweepRenderedMessages() {
  const messages: Iterable<TablemateChatMessage> | undefined = game.messages
  if (!messages) return
  for (const message of messages) {
    const originUserId = tablemateChatOriginUserId(message)
    if (!originUserId) continue
    const element = findRenderedChatMessage(message)
    if (!element) continue
    applyChatOriginDisplay(message, originUserId, element)
    observeChatOriginByline(message, originUserId, element)
  }
}

export function setupChatOriginDisplay() {
  if (chatOriginDisplayRegistered) return
  chatOriginDisplayRegistered = true

  // renderChatMessageHTML fires for every render AFTER registration — new posts,
  // updates, and messages lazily rendered as the log is scrolled.
  onHook('renderChatMessageHTML', (message: TablemateChatMessage, html: unknown) => {
    const originUserId = tablemateChatOriginUserId(message)
    if (!originUserId) return

    const element = chatMessageElement(html) ?? findRenderedChatMessage(message)
    if (!element) return

    // Correct whatever is already present (the OOC sender fallback, the
    // manual-roll badge, and the `.user` byline on a re-render where it's
    // already there)...
    applyChatOriginDisplay(message, originUserId, element)
    // ...then catch PF2e's late byline/portrait injection.
    observeChatOriginByline(message, originUserId, element)
  })

  // ...and catch the initial batch that rendered before we registered.
  sweepRenderedMessages()
  window.requestAnimationFrame(sweepRenderedMessages)
}
