// Shared helpers for the chat-render hooks (chat origin display + spell card
// targeting). These read Tablemate flags off a ChatMessage and locate its
// rendered DOM element, regardless of which flag-access shape Foundry hands us.

import type { ActorPF2e, SpellPF2e } from '@7h3laughingman/pf2e-types'

export type TablemateChatMessage = {
  id?: string | null
  _id?: string | null
  author?: { id?: string; _id?: string; name?: string } | null
  item?: {
    isOfType?: (...types: string[]) => boolean
    embeddedSpell?: SpellPF2e<ActorPF2e> | null
    rollAttack?: (
      event: PointerEvent,
      attackNumber?: number,
      context?: { target?: ActorPF2e | null }
    ) => Promise<unknown>
    rollDamage?: (event: PointerEvent, mapIncreases?: 0 | 1 | 2) => Promise<unknown>
  } | null
  flags?: {
    tablemate?: {
      originUserId?: string | null
      targetTokenIds?: string[] | null
    }
  }
  'flags.tablemate.targetTokenIds'?: string[] | null
  'flags.tablemate.originUserId'?: string | null
  getFlag?: (scope: string, key: string) => unknown
}

export function tablemateTargetTokenIds(message: TablemateChatMessage): string[] {
  const flagged = message.getFlag?.('tablemate', 'targetTokenIds')
  const value =
    (Array.isArray(flagged) ? flagged : undefined) ??
    message.flags?.tablemate?.targetTokenIds ??
    message['flags.tablemate.targetTokenIds'] ??
    []
  return value.filter((id): id is string => typeof id === 'string' && id.length > 0)
}

export function hasTablemateTargetTokenIds(message: TablemateChatMessage): boolean {
  return (
    Array.isArray(message.getFlag?.('tablemate', 'targetTokenIds')) ||
    Array.isArray(message.flags?.tablemate?.targetTokenIds) ||
    Array.isArray(message['flags.tablemate.targetTokenIds'])
  )
}

export function chatMessageElement(html: unknown): HTMLElement | undefined {
  if (html instanceof HTMLElement) return html
  if (typeof DocumentFragment !== 'undefined' && html instanceof DocumentFragment) {
    return html.firstElementChild instanceof HTMLElement ? html.firstElementChild : undefined
  }
  if (!html || typeof html !== 'object') return undefined

  const maybeCollection = html as {
    0?: unknown
    get?: (index: number) => unknown
    querySelector?: unknown
  }
  if (typeof maybeCollection.querySelector === 'function') return html as HTMLElement

  const first =
    typeof maybeCollection.get === 'function' ? maybeCollection.get(0) : maybeCollection[0]
  return first instanceof HTMLElement ? first : undefined
}

export function chatMessageId(message: TablemateChatMessage): string | undefined {
  return message.id ?? message._id ?? undefined
}

export function findRenderedChatMessage(message: TablemateChatMessage): HTMLElement | undefined {
  const id = chatMessageId(message)
  if (!id) return undefined
  return (
    document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`) ??
    document.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(id)}"]`) ??
    document.querySelector<HTMLElement>(`[data-document-id="${CSS.escape(id)}"]`) ??
    document.querySelector<HTMLElement>(`#chat-message-${CSS.escape(id)}`) ??
    undefined
  )
}
