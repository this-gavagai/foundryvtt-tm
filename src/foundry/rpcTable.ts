// The single registry of client-initiated RPCs.
//
// One entry per action, carrying everything the dispatch loop needs to know
// about it: which handler answers it, what authorization it requires, and
// whether it may run off the serialized dispatch chain.
//
// SEVEN of the entries below are LEGACY SHIMS: live, owner-authorized handlers
// the app no longer calls, because the operation moved to a direct write.
// UPDATE_ACTOR, SEND_CHAT_MESSAGE, the three compendium reads, TOGGLE_REACTION
// and SET_COMMENT. Each serves one skew direction — a stale NATIVE binary,
// since the PWA ships in this zip and cannot skew — and when they may go is a
// decision recorded in docs/BETA_ROLLOVER.md (0.2), tied to the support window
// rather than judged per handler. Deliberately not restated here: a policy in
// two places is a policy that drifts.
//
// WHETHER an operation belongs here at all is a separate question, and the four
// tests that decide it are written down once, at the top of api/documents.ts —
// the other lane. In short: an RPC buys the ability to run code on a Foundry
// client, and costs a round trip, this queue, and a GM being online. Most of
// the sheet's editing surface needs none of that and writes directly instead.
//
// This replaces four parallel structures in listener.ts — a handler map, an auth
// policy, a concurrent set and a passive set — all keyed by the same action
// string and each maintained by hand. Adding an RPC meant remembering all four,
// and only one of them (the auth policy) failed closed when you forgot. Now the
// three properties of an action are declared together, in one place, next to the
// handler they describe.
//
// RPC_TABLE is a REQUIRED Record<RpcAction, …>: an action added to
// ResponseByAction without an entry here is a compile error, not a request that
// mysteriously gets refused at the table. The same trick classifies the non-RPC
// actions below, so a new Foundry → browser action must also be accounted for.

import type {
  AcknowledgementArgs,
  ModuleEventArgs,
  ResponseByAction,
  RpcAction
} from '@/types/api-types'
import { TM } from '@/api/protocol'
import type { AuthRequirement } from './rpcAuthorize'
import {
  foundryAddCompendiumItem,
  foundryApplyDamage,
  foundryAttachItem,
  foundryCastSpell,
  foundryCastStaffSpell,
  foundryCharacterAction,
  foundryConsumeItem,
  foundryDetachItem,
  foundryFreeRoll,
  foundryGetCompendiumIndex,
  foundryGetCompendiumItem,
  foundryGetItemChoices,
  foundryGetSpellDamage,
  foundryGetStrikeDamage,
  foundryListCompendia,
  foundryNextTurn,
  foundryRerollChatRoll,
  foundryRollCheck,
  foundryRollDamage,
  foundryRollInlineCheck,
  foundryRunActionable,
  foundryRunMacro,
  foundrySetComment,
  foundrySetHitPoints,
  foundrySelectSpellVariant,
  foundrySendChatMessage,
  foundrySendCompendiumItemToChat,
  foundrySendImage,
  foundrySendItemToChat,
  foundrySendVoiceMemo,
  foundrySetWeaponDamageType,
  foundrySetWeaponLoaded,
  foundryToggleKineticAura,
  foundryToggleReaction,
  foundryUpdateActor,
  foundryUseAction
} from './handlers'
import { foundryRegisterPush } from './pushRegistration'

// A handler answers exactly one action. Args are narrowed via
// Extract<ModuleEventArgs, { action: K }> and the return is pinned to the
// per-action response contract (ResponseByAction), so both the request and the
// response shapes are type-checked against what the client expects.
export type RpcHandler<K extends RpcAction> = (
  args: Extract<ModuleEventArgs, { action: K }>
) => Promise<AcknowledgementArgs & ResponseByAction[K]>

export type RpcDescriptor<K extends RpcAction> = {
  handler: RpcHandler<K>
  auth: AuthRequirement
  // Read-only actions: no dice, no chat messages, no ambient roll state. These
  // dispatch concurrently — a multi-second compendium index fetch must not delay
  // a queued attack roll (nor a roll stall delay browsing) — and skip the
  // chat-origin push, since they create no messages to attribute.
  //
  // Everything else runs strictly one at a time. Three mechanisms read ambient
  // top-of-stack state while a handler runs (preset dice faces, damage modifier
  // overrides, chat attribution), so two interleaved requests would read each
  // other's context. See the dispatch chain in listener.ts.
  concurrent?: true
}

export type RpcTable = { [K in RpcAction]: RpcDescriptor<K> }

export const RPC_TABLE: RpcTable = {
  [TM.ROLL_CHECK]: { handler: foundryRollCheck, auth: 'owner' },
  [TM.CHARACTER_ACTION]: { handler: foundryCharacterAction, auth: 'owner' },
  [TM.CAST_SPELL]: { handler: foundryCastSpell, auth: 'owner' },
  [TM.CAST_STAFF_SPELL]: { handler: foundryCastStaffSpell, auth: 'owner' },
  [TM.SELECT_SPELL_VARIANT]: { handler: foundrySelectSpellVariant, auth: 'owner' },
  [TM.CONSUME_ITEM]: { handler: foundryConsumeItem, auth: 'owner' },
  [TM.GET_STRIKE_DAMAGE]: { handler: foundryGetStrikeDamage, auth: 'owner' },
  [TM.GET_SPELL_DAMAGE]: { handler: foundryGetSpellDamage, auth: 'owner' },
  [TM.SEND_CHAT_MESSAGE]: { handler: foundrySendChatMessage, auth: 'owner' },
  [TM.SEND_VOICE_MEMO]: { handler: foundrySendVoiceMemo, auth: 'owner' },
  [TM.SEND_IMAGE]: { handler: foundrySendImage, auth: 'owner' },
  [TM.SEND_ITEM_TO_CHAT]: { handler: foundrySendItemToChat, auth: 'owner' },
  [TM.SEND_COMPENDIUM_ITEM_TO_CHAT]: {
    handler: foundrySendCompendiumItemToChat,
    auth: 'owner'
  },
  [TM.SET_WEAPON_LOADED]: { handler: foundrySetWeaponLoaded, auth: 'owner' },
  [TM.SET_WEAPON_DAMAGE_TYPE]: { handler: foundrySetWeaponDamageType, auth: 'owner' },
  [TM.ATTACH_ITEM]: { handler: foundryAttachItem, auth: 'owner' },
  [TM.DETACH_ITEM]: { handler: foundryDetachItem, auth: 'owner' },
  [TM.TOGGLE_KINETIC_AURA]: { handler: foundryToggleKineticAura, auth: 'owner' },
  [TM.FREE_ROLL]: { handler: foundryFreeRoll, auth: 'owner' },
  [TM.ROLL_DAMAGE]: { handler: foundryRollDamage, auth: 'owner' },
  [TM.ROLL_INLINE_CHECK]: { handler: foundryRollInlineCheck, auth: 'owner' },
  [TM.RUN_MACRO]: { handler: foundryRunMacro, auth: 'owner' },
  [TM.RUN_ACTIONABLE]: { handler: foundryRunActionable, auth: 'owner' },
  [TM.USE_ACTION]: { handler: foundryUseAction, auth: 'owner' },
  [TM.UPDATE_ACTOR]: { handler: foundryUpdateActor, auth: 'owner' },
  [TM.ADD_COMPENDIUM_ITEM]: { handler: foundryAddCompendiumItem, auth: 'owner' },

  // "What would this item ask me to choose?" Read-only — it instantiates a temp
  // item to inflate PF2e's own ChoiceSet options and creates nothing, so it may
  // run off the serialized chain like the compendium reads. 'owner' rather than
  // 'world-user' because it reads the target actor's derived data (its roll
  // options decide which choices are even offered).
  [TM.GET_ITEM_CHOICES]: {
    handler: foundryGetItemChoices,
    auth: 'owner',
    concurrent: true
  },
  [TM.APPLY_DAMAGE]: { handler: foundryApplyDamage, auth: 'owner' },
  [TM.SET_HIT_POINTS]: { handler: foundrySetHitPoints, auth: 'owner' },
  [TM.REROLL_CHAT_ROLL]: { handler: foundryRerollChatRoll, auth: 'owner' },

  // End turn. 'owner' proves the requester owns the actor they named; whether
  // that actor actually holds the turn — the rule that stops a player ending
  // someone else's — is the handler's, since the table has no view of the
  // encounter. Deliberately NOT concurrent: it advances shared encounter state
  // and PF2e runs its turn-boundary automation off the resulting update.
  [TM.NEXT_TURN]: { handler: foundryNextTurn, auth: 'owner' },

  // Compendium browsing: read-only, no target actor, so any known world user may
  // do it — the per-pack observe check lives in the handlers (utils/permissions).
  [TM.GET_COMPENDIUM_ITEM]: {
    handler: foundryGetCompendiumItem,
    auth: 'world-user',
    concurrent: true
  },
  [TM.LIST_COMPENDIA]: { handler: foundryListCompendia, auth: 'world-user', concurrent: true },
  [TM.GET_COMPENDIUM_INDEX]: {
    handler: foundryGetCompendiumIndex,
    auth: 'world-user',
    concurrent: true
  },

  // LEGACY SHIM, kept for stale native app builds. A reaction is now written
  // directly to the reactor's own user document, so the app does not send this
  // and no dispatch-chain serialization is needed for the new path — the write
  // has one author by construction. Still 'world-user' + non-concurrent for the
  // old path it continues to serve: a read-modify-write on one message's flag,
  // containment in the handler (args.userId's own entry, palette emoji only).
  [TM.TOGGLE_REACTION]: { handler: foundryToggleReaction, auth: 'world-user' },

  // LEGACY SHIM, as TOGGLE_REACTION above. A comment now goes directly onto its
  // author's own user document, where "only its author may rewrite it" is
  // Foundry's document permission rather than the handler check this path still
  // performs. Non-concurrent for the old path's read-modify-write.
  [TM.SET_COMMENT]: { handler: foundrySetComment, auth: 'world-user' },

  // Any known world user may register their own device for push. A read-only
  // mint: no chat, no world mutation, so it needn't serialize behind the chain.
  [TM.REGISTER_PUSH]: { handler: foundryRegisterPush, auth: 'world-user', concurrent: true }
}

// Every action that is NOT a client-initiated RPC. Derived, so the
// classification below cannot fall behind the wire protocol.
type NonRpcAction = Exclude<ModuleEventArgs['action'], RpcAction>

// How the listener treats each non-RPC action:
//
//   'early'    answered before the table, each for its own reason — see
//              setupListener. ACK feeds the request-dedup guard and must be
//              observed from ANY answering client (so it is read before the
//              responder gate); REQUEST_CHARACTER is debounced per actor and
//              has its own ownership check; REQUEST_TARGETS is answered by the
//              client the request names rather than by the elected GM;
//              ANYBODY_HOME triggers the version check and presence announce.
//   'passive'  originates on this side (Foundry → browser). The listener sees it
//              on the wire and has nothing to do.
//
// `satisfies Record<NonRpcAction, …>` is the point of this map: a new
// Foundry → browser action must be classified here to compile, instead of
// silently reaching the table and being answered with an "unsupported action".
const NON_RPC_ACTIONS = {
  [TM.ACK]: 'early',
  [TM.REQUEST_CHARACTER]: 'early',
  [TM.REQUEST_TARGETS]: 'early',
  [TM.ANYBODY_HOME]: 'early',
  [TM.LISTENER_ONLINE]: 'passive',
  [TM.UPDATE_CHARACTER]: 'passive',
  [TM.SHARE_TARGETS]: 'passive'
} as const satisfies Record<NonRpcAction, 'early' | 'passive'>

export const PASSIVE_ACTIONS: ReadonlySet<string> = new Set(
  Object.entries(NON_RPC_ACTIONS)
    .filter(([, kind]) => kind === 'passive')
    .map(([action]) => action)
)

// Widened handler type for the dispatch loop, which holds a value it has only
// narrowed to "some action" — the per-action pairing is enforced at the table.
export type AnyRpcDescriptor = {
  handler: (args: ModuleEventArgs) => Promise<AcknowledgementArgs>
  auth: AuthRequirement
  concurrent?: true
}

// The descriptor for an action off the wire, or undefined when this module has
// no entry for it (an app newer than the module, or a hand-crafted payload).
//
// hasOwnProperty, not a bare index: `action` is an untrusted string off the
// socket, and a plain-object lookup answers 'constructor' / 'toString' with an
// inherited function. That would be a truthy descriptor with no `auth` and no
// `handler` — refused downstream by the fail-closed auth gate, but as
// "unauthorized" rather than "unsupported action", and one gate away from
// calling Object as a handler.
export function rpcDescriptor(action: string): AnyRpcDescriptor | undefined {
  if (!Object.prototype.hasOwnProperty.call(RPC_TABLE, action)) return undefined
  return (RPC_TABLE as Record<string, AnyRpcDescriptor>)[action]
}
