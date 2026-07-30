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
//   3 — ROLL_CHECK's checkSubtype is a typed object (CheckSubtypeByType) instead
//       of a comma-packed positional string, and GET_STRIKE_DAMAGE carries blasts
//       in a dedicated `blast` field instead of a 'blast:'-prefixed actionSlug.
//       The module still decodes both legacy string forms (checkSubtypeOf /
//       blastDamageQueryOf), so an older app keeps working against a newer
//       module; the reverse (new app, stale module) fails and shows the banner.
export const PROTOCOL_VERSION = 3

// Error-ack sentinel: the request carried player-determined dice results while
// the world's manual-roll policy is 'reject'. The app matches this string
// verbatim to distinguish a policy refusal from a real handler failure (and to
// self-heal its cached policy if it fired before hearing the announcement).
export const TM_ERROR_MANUAL_ROLLS_DISABLED = 'TM_MANUAL_ROLLS_DISABLED'

// Error-ack sentinel: the requesting user failed the module's authorization
// check (AUTH_POLICY in foundry/listener.ts) — e.g. they don't own the target
// actor. Sent instead of silently dropping the request, so the app rejects
// immediately with a distinguishable cause rather than waiting out the 30s
// client timeout that would otherwise read the same as "no GM online".
export const TM_ERROR_UNAUTHORIZED = 'TM_UNAUTHORIZED'

// Optional module capabilities advertised on the LISTENER_ONLINE handshake.
// Additive features live here rather than behind a PROTOCOL_VERSION bump, so an
// app talking to an older module simply hides the affordance (no scary version
// banner). The app gates the voice-memo composer on this being present.
export const CAPABILITY_VOICE_MEMO = 'voiceMemo'

// Advertised once the GM has configured an image-upload destination folder.
// The app gates the composer's image-attach button on this being present, the
// same way it gates the mic on CAPABILITY_VOICE_MEMO.
export const CAPABILITY_IMAGE_UPLOAD = 'imageUpload'

// Emoji reactions on chat messages. Unlike the media capabilities this needs no
// world configuration, so it's advertised unconditionally — its only job is
// version detection: a module predating reactions would log 'event not caught'
// and never answer, leaving the app's tap to time out after 30s. Gating the
// affordance on the capability hides it instead.
export const CAPABILITY_REACTIONS = 'reactions'

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
  // Voice memo: the app records audio and streams it to the GM client in
  // base64 byte-slices (one RPC per chunk, keyed by a shared uploadId), which
  // reassembles them, uploads the file via Foundry's FilePicker, and posts a
  // ChatMessage referencing it. Chunked because a multi-minute clip exceeds
  // Foundry's per-message socket buffer. See foundry/handlers/chat.ts.
  SEND_VOICE_MEMO: 'sendVoiceMemo',
  // Image upload: the app picks (and downscales) an image and streams it to the
  // GM client in base64 byte-slices — the identical chunked mechanism as
  // SEND_VOICE_MEMO — which reassembles, uploads via FilePicker, and posts a
  // ChatMessage referencing it. See foundry/handlers/chat.ts.
  SEND_IMAGE: 'sendImage',
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
  REROLL_CHAT_ROLL: 'rerollChatRoll',
  // Emoji reaction toggle. Unlike posting/editing/deleting a message — which the
  // app now does directly over the modifyDocument socket as its own user — a
  // reaction writes a flag on SOMEONE ELSE'S message, which Foundry only permits
  // the author or a GM to do. So it has to be an RPC through the GM client. See
  // foundry/handlers/reactions.ts.
  TOGGLE_REACTION: 'toggleReaction',
  // Push registration: the app asks the module (GM's client) for a short-lived,
  // signed token binding {worldId, userId} plus the relay URL, then registers
  // its device token with the relay. See foundry/pushRegistration.ts.
  REGISTER_PUSH: 'registerPush'
} as const
