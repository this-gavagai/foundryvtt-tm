// Tiny wrappers around Foundry-injected globals. Centralized so the handler
// modules don't each reach into `parent.game` / `window.game` directly.

import type { CharacterPF2e, GamePF2e } from '@7h3laughingman/pf2e-types'
import type { AcknowledgementArgs } from '@/types/api-types'
import { TM } from '@/api/protocol'
import { logger } from '@/utils/utilities'

export function getGame(): GamePF2e {
  return (typeof window.game === 'undefined' ? parent.game : window.game) as GamePF2e
}

export function getCharacter(source: GamePF2e, id: string): CharacterPF2e {
  return source.actors.get(id, { strict: true }) as unknown as CharacterPF2e
}

export function makeAck(args: { uuid: string }): AcknowledgementArgs {
  return { action: TM.ACK, uuid: args.uuid, userId: game.user._id ?? '' }
}

export function tablemateChatOriginUserId(message: unknown): string | undefined {
  const document = message as {
    getFlag?: (scope: string, key: string) => unknown
    flags?: { tablemate?: { originUserId?: string | null } }
    'flags.tablemate.originUserId'?: string | null
  }
  const flagged = document.getFlag?.('tablemate', 'originUserId')
  return typeof flagged === 'string'
    ? flagged
    : (document.flags?.tablemate?.originUserId ??
        document['flags.tablemate.originUserId'] ??
        undefined)
}

// Request uuid stamped onto a chat message the Foundry side created while a
// tablemate request was on the chat-origin stack. Read by the createChatMessage
// hook to resolve the matching capture (see foundry/chatCapture.ts).
export function tablemateChatOriginUuid(message: unknown): string | undefined {
  const document = message as {
    getFlag?: (scope: string, key: string) => unknown
    flags?: { tablemate?: { originUuid?: string | null } }
  }
  const flagged = document.getFlag?.('tablemate', 'originUuid')
  return typeof flagged === 'string'
    ? flagged
    : (document.flags?.tablemate?.originUuid ?? undefined)
}

// True when the message was produced by a request whose dice faces were
// player-determined (manual picker / Pixel dice) under the 'flag' policy.
// Stamped in listener.ts (stampChatOrigin); read by chatOriginDisplay.ts to
// render the "manual" tag on the chat card.
export function tablemateManualRoll(message: unknown): boolean {
  const document = message as {
    getFlag?: (scope: string, key: string) => unknown
    flags?: { tablemate?: { manualRoll?: boolean | null } }
  }
  return (
    document.getFlag?.('tablemate', 'manualRoll') === true ||
    document.flags?.tablemate?.manualRoll === true
  )
}

export async function stampTablemateChatOrigin(message: unknown, originUserId: string) {
  if (!message || tablemateChatOriginUserId(message)) return
  const document = message as {
    setFlag?: (scope: string, key: string, value: string) => Promise<unknown>
    updateSource?: (changes: { flags: { tablemate: { originUserId: string } } }) => unknown
  }
  if (typeof document.updateSource === 'function') {
    document.updateSource({ flags: { tablemate: { originUserId } } })
  }
  if (typeof document.setFlag === 'function') {
    try {
      await document.setFlag('tablemate', 'originUserId', originUserId)
    } catch (error) {
      logger.warn('failed to stamp Tablemate chat origin', error)
    }
  }
}

// Synthesizes the minimal event shape PF2e roll methods inspect. shiftKey is
// pulled from the user's "showDamageDialogs" setting so we honour their dialog
// preference; ctrl/meta are normalized to false.
export function makeFakeEvent(source: GamePF2e) {
  return { ctrlKey: false, metaKey: false, shiftKey: source.user.settings['showDamageDialogs'] }
}
