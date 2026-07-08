// World-scoped GM policy for rolls that arrive with player-determined dice
// faces (the app's manual face picker or Pixel dice). Registered as a module
// setting so the GM controls it from Foundry's settings UI; enforcement lives
// in listener.ts, which is the single dispatch point every diceResults payload
// passes through before withBackgroundRoll() can stamp the faces onto a Roll.

import { MODULE_ID } from '@/api/protocol'
import type { DiceResults, ManualRollPolicy } from '@/types/api-types'

declare const game: {
  settings: {
    register: (scope: string, key: string, config: object) => void
    get: (scope: string, key: string) => unknown
  }
}

export const MANUAL_ROLL_POLICY_SETTING = 'manualRollPolicy'

// Setting strings are raw English, matching the registerMenu precedent in
// tablemate.ts (the module ships no Foundry lang files).
export function registerManualRollPolicySetting(onChange: () => void) {
  game.settings.register(MODULE_ID, MANUAL_ROLL_POLICY_SETTING, {
    name: 'Player-supplied dice results',
    hint:
      'How to handle Tablemate rolls that arrive with the dice results already ' +
      'determined (manual face picker or Pixel dice): allow them, allow but tag ' +
      'the chat message, or reject the roll so it must be re-sent as a normal roll.',
    scope: 'world',
    config: true,
    type: String,
    choices: {
      allow: 'Allow',
      flag: 'Allow, but tag the chat message',
      reject: 'Reject'
    },
    default: 'allow',
    onChange
  })
}

export function manualRollPolicy(): ManualRollPolicy {
  try {
    const value = game.settings.get(MODULE_ID, MANUAL_ROLL_POLICY_SETTING)
    return value === 'flag' || value === 'reject' ? value : 'allow'
  } catch {
    // Setting not registered yet (or an unexpectedly old world) — fail open to
    // today's behavior rather than blocking rolls.
    return 'allow'
  }
}

// True when any die pool carries a real face. The upstream API shapes payloads
// as e.g. { d20: [face ?? 0] }, using 0 as the "no override, roll live"
// sentinel (see backgroundRoll.js), so zeros don't count as preset results.
export function hasPresetDiceResults(diceResults: DiceResults | undefined): boolean {
  if (!diceResults || typeof diceResults !== 'object') return false
  return Object.values(diceResults).some(
    (pool) => Array.isArray(pool) && pool.some((face) => !!face)
  )
}
