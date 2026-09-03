// World-scoped GM switches for the three Tabula features that are opt-in:
// chat reactions, chat comments, and the roll-result details (what a roll was
// aimed at and how it came out).
//
// All three default to OFF. They are not media features that need a destination
// folder before they can work — they work the moment the module is installed —
// so nothing else would ever ask the GM whether they want them. A table that
// wants its chat log to stay exactly as Foundry draws it, or that does not want
// DCs and degrees of success travelling to tablets at all, gets that by default
// and turns on what it wants.
//
// Each switch is enforced in three places, the same defence-in-depth the media
// settings use:
//
//   • the handshake — the capability is withheld from announceSelf (see
//     listener.ts), so the app hides the affordance entirely rather than
//     offering a button whose request would go unanswered;
//   • the handler — TOGGLE_REACTION and SET_COMMENT refuse, so a stale app or a
//     hand-built socket message cannot write the flag anyway;
//   • the Foundry client — reactionDisplay/commentDisplay draw nothing and add
//     no context-menu entries, so "off" means off at the table's own screens
//     too, not just on the tablets.
//
// The roll-result switch needs no capability: its payload rides the ack rather
// than being requested, so withholding the data IS the gate — describeRollOutcome
// returns undefined and the app's modal already renders nothing for an absent
// outcome, exactly as it does when talking to a module too old to send one.
//
// Reads fail CLOSED. A setting that is not registered yet (a capability probe
// before ready, an unexpectedly old world) reads as off, which matches the
// default and can only ever withhold a feature, never leak one.

import {
  MODULE_ID,
  REACTIONS_ENABLED_SETTING,
  COMMENTS_ENABLED_SETTING,
  ROLL_OUTCOME_ENABLED_SETTING
} from '@/api/protocol'
import { settingsApi } from './globals'

// Field names live in api/protocol.ts, with the rest of the shared contract: the
// app reads these settings out of core's world dump rather than being told about
// them, so both ends have to spell them the same way.
export { REACTIONS_ENABLED_SETTING, COMMENTS_ENABLED_SETTING, ROLL_OUTCOME_ENABLED_SETTING }

// Setting strings are raw English, matching the other module settings (the
// module ships no Foundry lang files).

// Registered next to the manual-roll policy so both dice settings sit in one
// section — settingsHeaders.ts anchors its headers on registration order.
export function registerRollOutcomeSetting(onChange: () => void) {
  settingsApi().register(MODULE_ID, ROLL_OUTCOME_ENABLED_SETTING, {
    name: 'Show roll details in Tabula',
    hint:
      'When on, a roll made from Tabula reports what it was aimed at and how ' +
      'it came out — the target, the DC, and the degree of success — on the ' +
      "roller's own result screen. Each part still follows the system's " +
      'metagame settings, so a player is never told a DC or a result that the ' +
      'chat log would have hidden from them. When off, the result screen shows ' +
      'only the formula, the dice and the total.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
    onChange
  })
}

export function registerReactionsSetting(onChange: () => void) {
  settingsApi().register(MODULE_ID, REACTIONS_ENABLED_SETTING, {
    name: 'Enable chat reactions',
    hint:
      'Let players react to chat messages with an emoji, from Tabula or from ' +
      "the Foundry chat log's right-click menu. When off, no reactions can be " +
      'added and existing ones are not drawn — they stay in the message data ' +
      'and reappear if this is turned back on.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
    onChange
  })
}

export function registerCommentsSetting(onChange: () => void) {
  settingsApi().register(MODULE_ID, COMMENTS_ENABLED_SETTING, {
    name: 'Enable chat comments',
    hint:
      'Let players write a short note on a chat message, from Tabula or from ' +
      "the Foundry chat log's right-click menu. When off, no comments can be " +
      'written and existing ones are not drawn — they stay in the message data ' +
      'and reappear if this is turned back on.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
    onChange
  })
}

function enabled(key: string): boolean {
  try {
    return settingsApi().get(MODULE_ID, key) === true
  } catch {
    // Not registered yet (or an unexpectedly old world): treat as off, matching
    // the default. Failing closed here can only withhold a feature.
    return false
  }
}

export function reactionsEnabled(): boolean {
  return enabled(REACTIONS_ENABLED_SETTING)
}

export function commentsEnabled(): boolean {
  return enabled(COMMENTS_ENABLED_SETTING)
}

export function rollOutcomeEnabled(): boolean {
  return enabled(ROLL_OUTCOME_ENABLED_SETTING)
}
