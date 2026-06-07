import type { SendChatMessageArgs } from '@/types/api-types'
import { getGame, makeAck } from '../utils/foundry'

declare const ChatMessage: {
  create: (data: object) => Promise<unknown>
  getSpeaker: (opts: { actor?: unknown }) => unknown
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatChatContent(content: string): string {
  return escapeHtml(content.trim()).replace(/\n/g, '<br>')
}

export async function foundrySendChatMessage(args: SendChatMessageArgs) {
  const content = formatChatContent(args.content)
  if (!content) return makeAck(args)

  const source = getGame()
  const actor = source.actors.get(args.characterId, { strict: true })
  await ChatMessage.create({
    author: args.userId,
    speaker: ChatMessage.getSpeaker({ actor }),
    content
  })
  return makeAck(args)
}
