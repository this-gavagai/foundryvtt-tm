// Wire-protocol identifiers for the tablemate socket channel. Centralized
// so both ends of the protocol (browser + Foundry side) reference one
// source of truth. Discriminator types in api-types.ts derive from these
// via `typeof TM.X`, so a rename here propagates through the whole codebase.

// Foundry package id of the module. Used app-side to read the running module's
// version off game.modules, and as the flag scope on the Foundry side.
export const MODULE_ID = 'tablemate'

// Wire-protocol compatibility version. Bump ONLY when a change to the messages
// in this file (or their payloads/semantics) breaks an older peer — NOT on every
// release. Both ends are built from the same commit, so they always agree for a
// given build; a mismatch only happens at deploy time when a stale PWA talks to
// a freshly-updated module (or vice versa). Each end compares this integer (not
// the human-readable release tag) to decide compatibility, so unrelated patch
// releases don't needlessly hard-block users whose PWA hasn't refreshed yet.
//
// History:
//   2 — ACK messages may carry an optional `error` string (RequestResolutionArgs):
//       a thrown Foundry-side handler now answers with an error ack that the app
//       rejects on, instead of the request hanging until the client timeout.
export const PROTOCOL_VERSION = 2

export const TM = {
  // Socket.io channel name. All tablemate messages flow over this channel.
  CHANNEL: 'module.tablemate',

  // Server-initiated (Foundry → browser)
  ACK: 'acknowledged',
  UPDATE_CHARACTER: 'updateCharacterDetails',
  LISTENER_ONLINE: 'listenerOnline',
  SHARE_TARGETS: 'shareTargets',

  // Client-initiated (browser → Foundry)
  UPDATE_ACTOR: 'updateActor',
  REQUEST_CHARACTER: 'requestCharacterDetails',
  ANYBODY_HOME: 'anybodyHome',
  ROLL_CHECK: 'rollCheck',
  CHARACTER_ACTION: 'characterAction',
  CAST_SPELL: 'castSpell',
  CONSUME_ITEM: 'consumeItem',
  GET_STRIKE_DAMAGE: 'getStrikeDamage',
  SEND_CHAT_MESSAGE: 'sendChatMessage',
  SEND_ITEM_TO_CHAT: 'sendItemToChat',
  SET_WEAPON_LOADED: 'setWeaponLoaded',
  SET_WEAPON_DAMAGE_TYPE: 'setWeaponDamageType',
  ATTACH_ITEM: 'attachItem',
  DETACH_ITEM: 'detachItem',
  TOGGLE_KINETIC_AURA: 'toggleKineticAura',
  CAST_STAFF_SPELL: 'castStaffSpell',
  FREE_ROLL: 'freeRoll',
  ROLL_DAMAGE: 'rollDamage',
  ROLL_INLINE_CHECK: 'rollInlineCheck',
  RUN_MACRO: 'runMacro',
  RUN_ACTIONABLE: 'runActionable',
  GET_SPELL_DAMAGE: 'getSpellDamage',
  GET_COMPENDIUM_ITEM: 'getCompendiumItem',
  ADD_COMPENDIUM_ITEM: 'addCompendiumItem',
  LIST_COMPENDIA: 'listCompendia',
  GET_COMPENDIUM_INDEX: 'getCompendiumIndex',
  SEND_COMPENDIUM_ITEM_TO_CHAT: 'sendCompendiumItemToChat',
  APPLY_DAMAGE: 'applyDamage',
  REROLL_CHAT_ROLL: 'rerollChatRoll'
} as const
