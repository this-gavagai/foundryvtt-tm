import type { ChatRollRerollMode, RerollChatRollArgs, SendChatMessageArgs } from '@/types/api-types'
import type { GamePF2e } from '@7h3laughingman/pf2e-types'
import { withBackgroundRoll } from '../backgroundRoll'
import { registerCapture } from '../chatCapture'
import { extractRollPayload } from '../utils/roll'
import { getCharacter, getGame, makeAck } from '../utils/foundry'

declare const ChatMessage: {
  create: (data: object) => Promise<unknown>
  getSpeaker: (opts: { actor?: unknown }) => unknown
}

interface WhisperUser {
  id?: string | null
  name?: string | null
  isGM?: boolean
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

const WHISPER_PREFIX = /^\/w(?:hisper)?\s+/i

// Parse Foundry's `/w` / `/whisper` syntax. Targets may be bracketed
// (`[Display Name]`, so names with spaces work) or a single bare token, and
// several may be comma-separated. The first target not followed by a comma
// ends the recipient list; everything after it is the message body. Returns
// null when the text isn't a whisper command.
function parseWhisperCommand(raw: string): { targets: string[]; content: string } | null {
  if (!WHISPER_PREFIX.test(raw)) return null
  let rest = raw.replace(WHISPER_PREFIX, '')
  const targets: string[] = []
  const tokenPattern = /^(\[[^\]]+\]|[^\s,]+)\s*(,)?\s*/
  while (rest.length) {
    const match = tokenPattern.exec(rest)
    if (!match) break
    targets.push(match[1])
    rest = rest.slice(match[0].length)
    if (!match[2]) break // no trailing comma — the rest is the message body
  }
  return { targets, content: rest }
}

// Resolve whisper target names to Foundry user ids, mirroring Foundry's own
// recipient lookup: the `gm`/`dm` keyword targets all GMs, `players` targets all
// non-GMs, and any other name is matched case-insensitively against user names.
function resolveWhisperRecipients(source: GamePF2e, targets: string[]): string[] {
  const users = Array.from(source.users as Iterable<WhisperUser>)
  const ids = new Set<string>()
  const addAll = (matches: WhisperUser[]) =>
    matches.forEach((u) => {
      if (u.id) ids.add(u.id)
    })

  for (const target of targets) {
    const name = target.replace(/[[\]]/g, '').trim()
    if (!name) continue
    const lower = name.toLowerCase()
    if (lower === 'gm' || lower === 'dm') {
      addAll(users.filter((u) => u.isGM))
    } else if (lower === 'players') {
      addAll(users.filter((u) => !u.isGM))
    } else {
      addAll(users.filter((u) => u.name?.toLowerCase() === lower))
    }
  }
  return [...ids]
}

export async function foundrySendChatMessage(args: SendChatMessageArgs) {
  const source = getGame()
  const actor = source.actors.get(args.characterId, { strict: true })

  const whisper = parseWhisperCommand(args.content.trimStart())
  const content = formatChatContent(whisper ? whisper.content : args.content)
  if (!content) return makeAck(args)

  const data: Record<string, unknown> = {
    author: args.userId,
    speaker: ChatMessage.getSpeaker({ actor }),
    content
  }

  if (whisper) {
    const recipients = resolveWhisperRecipients(source, whisper.targets)
    // An empty `whisper` array reads as a public message in Foundry, which would
    // leak a message the user meant to be private. When nothing resolves, scope
    // it to the author so it stays out of other players' overlays.
    data.whisper = recipients.length ? recipients : [args.userId]
  }

  await ChatMessage.create(data)
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

  // PF2e's rerollFromMessage creates the replacement message internally without
  // returning it; capture it by request uuid (see chatCapture.ts) rather than
  // grabbing the globally-next message.
  const rerollMessage = await withBackgroundRoll(args.diceResults, async () => {
    const capture = registerCapture(args.uuid)
    await source.pf2e.Check.rerollFromMessage(message as never, rerollOptionsForMode(args.mode))
    return capture
  })

  return { ...makeAck(args), ...extractRollPayload(rerollMessage?.rolls?.[0], args) }
}
