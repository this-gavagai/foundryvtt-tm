import type { ChatRollRerollMode, RerollChatRollArgs, SendChatMessageArgs } from '@/types/api-types'
import { useBackgroundRoll } from '../backgroundRoll'
import { extractRollPayload } from '../utils/roll'
import { getCharacter, getGame, makeAck } from '../utils/foundry'

declare const ChatMessage: {
  create: (data: object) => Promise<unknown>
  getSpeaker: (opts: { actor?: unknown }) => unknown
}
declare const Hooks: {
  once: (event: string, cb: (msg: { rolls?: unknown[] }) => void) => number
  off: (event: string, id: number) => void
}

type RerollKeep = 'new' | 'higher' | 'lower'

type RerollableChatMessage = {
  rolls?: Array<{ class?: string } | undefined>
  isRerollable?: boolean
  actor?: { _id?: string | null } | null
  speaker?: { actor?: string | null }
}

function rerollOptionsForMode(mode: ChatRollRerollMode): { resource?: string; keep?: RerollKeep } {
  switch (mode) {
    case 'hero-point':
      return { resource: 'hero-points', keep: 'new' }
    case 'keep-highest':
      return { keep: 'higher' }
    case 'keep-lowest':
      return { keep: 'lower' }
    case 'reroll':
    default:
      return { keep: 'new' }
  }
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

export async function foundryRerollChatRoll(args: RerollChatRollArgs) {
  const source = getGame()
  const actor = getCharacter(source, args.characterId)
  const message = source.messages.get(args.messageId) as RerollableChatMessage | undefined
  if (!message) return makeAck(args)

  const messageActorId = message.actor?._id ?? message.speaker?.actor
  if (messageActorId !== actor._id) return makeAck(args)

  const roll = message.rolls?.[args.rollIndex ?? 0]
  if (roll?.class && roll.class !== 'CheckRoll') return makeAck(args)
  if (message.isRerollable === false) return makeAck(args)
  if (args.mode === 'hero-point' && actor.heroPoints.value <= 0) return makeAck(args)

  const { registerBackgroundRoll, unregisterBackgroundRoll } = useBackgroundRoll(args.diceResults)
  let resolveMessage: ((msg: { rolls?: unknown[] } | undefined) => void) | undefined
  const messagePromise = new Promise<{ rolls?: unknown[] } | undefined>((resolve) => {
    resolveMessage = resolve
  })
  const hookId = Hooks.once('createChatMessage', (msg) => resolveMessage?.(msg))
  const timeoutId = setTimeout(() => {
    Hooks.off('createChatMessage', hookId)
    resolveMessage?.(undefined)
  }, 5000)

  let rerollMessage: { rolls?: unknown[] } | undefined
  try {
    registerBackgroundRoll()
    await source.pf2e.Check.rerollFromMessage(message as never, rerollOptionsForMode(args.mode))
    rerollMessage = await messagePromise
  } finally {
    clearTimeout(timeoutId)
    Hooks.off('createChatMessage', hookId)
    unregisterBackgroundRoll()
  }

  return { ...makeAck(args), ...extractRollPayload(rerollMessage?.rolls?.[0], args) }
}
