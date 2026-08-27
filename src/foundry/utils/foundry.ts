// Chat-origin flag helpers and the small synthesized values handlers need
// (acks, the fake event PF2e roll methods inspect).
//
// The Foundry-injected globals themselves live in ../globals.ts. getGame is
// re-exported from here because every handler already imports it from this path.

import type { ActorPF2e, GamePF2e } from '@7h3laughingman/pf2e-types'
import type { AcknowledgementArgs } from '@/types/api-types'
import { TM } from '@/api/protocol'
import { logger } from '@/utils/utilities'

export { getGame } from '../globals'

export function getCharacter(source: GamePF2e, id: string): ActorPF2e {
  return source.actors.get(id, { strict: true })
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
// The stand-in this module passes as PF2e's `event` parameter.
//
// PF2e's roll paths take a real DOM event, and read exactly two things off it:
// the modifier keys — shift decides whether the roll dialog opens, which the
// user's showDamageDialogs setting is the socket-side answer to — and, on the
// spell-damage path, `event.target`, which PF2e walks with htmlClosest to find
// [data-cast-rank] (see makeCastRankEvent in utils/roll.ts). Nothing here has a
// real event to hand it: these rolls arrive over a socket, not from a click.
//
// A real PointerEvent is not an option. It is constructible in a browser but not
// in this module's tests, which run without a DOM, and `target` is read-only on
// a real event — settable only by dispatching it, which would run Foundry's own
// listeners as a side effect of previewing damage.
//
// So it stays a plain object, and the assertion PF2e's signature forces lives
// here, once, instead of at each of the four call sites. `target` is a real
// element when given: htmlClosest does an `instanceof Element` check.
export function makeFakeEvent(source: GamePF2e, target?: Element): PointerEvent {
  const shiftKey = source.user.settings['showDamageDialogs']
  return { ctrlKey: false, metaKey: false, shiftKey, target } as unknown as PointerEvent
}

// Build a chat speaker for an actor WITHOUT touching the GM client's canvas.
// ChatMessage.getSpeaker resolves scene/token from whatever scene the GM
// happens to have open — which is wrong for a remote player's message (it can
// pick up the GM's selected token) and is undefined when the GM has no scene
// loaded. That canvas dependency is also what trips third-party
// preCreateChatMessage hooks that resolve the token via `canvas.tokens.get(...)`
// (the "Cannot read properties of undefined (reading 'get')" seen on voice-memo
// posts). Attributing by actor id + name is canvas-independent and still shows
// the character — the app falls back to the actor portrait when no token rides
// on the speaker.
export function actorSpeaker(actor: { id?: string | null; name?: string | null }): {
  actor?: string
  alias?: string
} {
  return { actor: actor.id ?? undefined, alias: actor.name ?? undefined }
}
