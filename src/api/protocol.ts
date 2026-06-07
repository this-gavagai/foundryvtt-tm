// Wire-protocol identifiers for the tablemate socket channel. Centralized
// so both ends of the protocol (browser + Foundry side) reference one
// source of truth. Discriminator types in api-types.ts derive from these
// via `typeof TM.X`, so a rename here propagates through the whole codebase.

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
  APPLY_DAMAGE: 'applyDamage'
} as const
