// Tiny wrappers around Foundry-injected globals. Centralized so the handler
// modules don't each reach into `parent.game` / `window.game` directly.

import type { CharacterPF2e, GamePF2e } from '@7h3laughingman/pf2e-types'
import { TM } from '@/api/protocol'

export function getGame(): GamePF2e {
  return (typeof window.game === 'undefined' ? parent.game : window.game) as GamePF2e
}

export function getCharacter(source: GamePF2e, id: string): CharacterPF2e {
  return source.actors.get(id, { strict: true }) as unknown as CharacterPF2e
}

export function makeAck(args: { uuid: string }) {
  return { action: TM.ACK, uuid: args.uuid, userId: game.user._id }
}

// Synthesizes the minimal event shape PF2e roll methods inspect. shiftKey is
// pulled from the user's "showDamageDialogs" setting so we honour their dialog
// preference; ctrl/meta are normalized to false.
export function makeFakeEvent(source: GamePF2e) {
  return { ctrlKey: false, metaKey: false, shiftKey: source.user.settings['showDamageDialogs'] }
}
