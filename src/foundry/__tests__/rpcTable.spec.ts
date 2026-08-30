import { describe, it, expect } from 'vitest'
import { TM } from '@/api/protocol'
import type { RpcAction } from '@/types/api-types'
import { PASSIVE_ACTIONS, RPC_TABLE, rpcDescriptor } from '@/foundry/rpcTable'
import type { AuthRequirement } from '@/foundry/rpcAuthorize'

// RPC_TABLE replaced four hand-maintained structures in listener.ts: a handler
// map, an auth policy, a concurrent set and a passive set. TypeScript enforces
// that every RpcAction has an entry; what it cannot enforce is that each entry
// says what the old structures said. So EXPECTED below is a golden copy of the
// pre-refactor behaviour, written out by hand — if the table ever disagrees with
// it, either the refactor dropped something or a deliberate policy change needs
// recording here too.
//
// It doubles as the review a new RPC gets: adding one means adding a line here,
// which is the moment to ask whether 'world-user' is really enough and whether
// the handler is genuinely free of dice, chat and ambient roll state.

type Expected = { auth: AuthRequirement; concurrent?: true }

const EXPECTED: Record<RpcAction, Expected> = {
  // ── Owner-gated: everything that rolls, spends, mutates, or speaks as a
  // character. The requester must own the actor named by the request.
  [TM.ROLL_CHECK]: { auth: 'owner' },
  [TM.CHARACTER_ACTION]: { auth: 'owner' },
  [TM.CAST_SPELL]: { auth: 'owner' },
  [TM.CAST_STAFF_SPELL]: { auth: 'owner' },
  [TM.SELECT_SPELL_VARIANT]: { auth: 'owner' },
  [TM.CONSUME_ITEM]: { auth: 'owner' },
  [TM.GET_STRIKE_DAMAGE]: { auth: 'owner' },
  [TM.GET_SPELL_DAMAGE]: { auth: 'owner' },
  [TM.SEND_CHAT_MESSAGE]: { auth: 'owner' },
  [TM.SEND_VOICE_MEMO]: { auth: 'owner' },
  [TM.SEND_IMAGE]: { auth: 'owner' },
  [TM.SEND_ITEM_TO_CHAT]: { auth: 'owner' },
  [TM.SEND_COMPENDIUM_ITEM_TO_CHAT]: { auth: 'owner' },
  [TM.SET_WEAPON_LOADED]: { auth: 'owner' },
  [TM.SET_WEAPON_DAMAGE_TYPE]: { auth: 'owner' },
  [TM.ATTACH_ITEM]: { auth: 'owner' },
  [TM.DETACH_ITEM]: { auth: 'owner' },
  [TM.TOGGLE_KINETIC_AURA]: { auth: 'owner' },
  [TM.FREE_ROLL]: { auth: 'owner' },
  [TM.ROLL_DAMAGE]: { auth: 'owner' },
  [TM.ROLL_INLINE_CHECK]: { auth: 'owner' },
  [TM.RUN_MACRO]: { auth: 'owner' },
  [TM.RUN_ACTIONABLE]: { auth: 'owner' },
  [TM.UPDATE_ACTOR]: { auth: 'owner' },
  [TM.ADD_COMPENDIUM_ITEM]: { auth: 'owner' },
  [TM.APPLY_DAMAGE]: { auth: 'owner' },
  [TM.REROLL_CHAT_ROLL]: { auth: 'owner' },

  // ── Read-only compendium browsing: no target actor, and safe to run off the
  // dispatch chain so a slow pack fetch can't delay a queued attack roll.
  [TM.GET_COMPENDIUM_ITEM]: { auth: 'world-user', concurrent: true },
  [TM.LIST_COMPENDIA]: { auth: 'world-user', concurrent: true },
  [TM.GET_COMPENDIUM_INDEX]: { auth: 'world-user', concurrent: true },

  // ── Player-scoped, not character-scoped.
  [TM.TOGGLE_REACTION]: { auth: 'world-user' },
  // Anyone in the world may comment on any message, so 'world-user' is the
  // whole gate; the narrower "only its author may rewrite a comment" rule is
  // about the stored comment, so it lives in the handler.
  [TM.SET_COMMENT]: { auth: 'world-user' },
  [TM.REGISTER_PUSH]: { auth: 'world-user', concurrent: true }
}

describe('RPC_TABLE', () => {
  it('matches the declared policy for every action', () => {
    const actual = Object.fromEntries(
      Object.entries(RPC_TABLE).map(([action, descriptor]) => [
        action,
        descriptor.concurrent
          ? { auth: descriptor.auth, concurrent: descriptor.concurrent }
          : { auth: descriptor.auth }
      ])
    )
    expect(actual).toEqual(EXPECTED)
  })

  it('binds a callable handler to every action', () => {
    for (const [action, descriptor] of Object.entries(RPC_TABLE)) {
      expect(typeof descriptor.handler, `handler for ${action}`).toBe('function')
    }
  })

  it('binds a DISTINCT handler to every action', () => {
    // A copy-paste slip in the table — two actions pointing at one handler — is
    // invisible to the type checker whenever the two share a response shape
    // (most of them ack plain), and at the table it means one action silently
    // does another's work.
    const byHandler = new Map<unknown, string[]>()
    for (const [action, descriptor] of Object.entries(RPC_TABLE)) {
      byHandler.set(descriptor.handler, [...(byHandler.get(descriptor.handler) ?? []), action])
    }
    const shared = [...byHandler.values()].filter((actions) => actions.length > 1)
    expect(shared).toEqual([])
  })

  // The dispatch chain is what serializes a read-modify-write on one message's
  // reaction flag; two players tapping at once through a concurrent handler would
  // read the same list and one write would clobber the other. This is a real bug
  // that was fixed by routing reactions through the chain — pin it so a future
  // "these are all read-only-ish" pass can't quietly undo it.
  it('keeps reactions on the serialized dispatch chain', () => {
    expect(RPC_TABLE[TM.TOGGLE_REACTION].concurrent).toBeUndefined()
  })

  // Same read-modify-write hazard, same fix: two people commenting on one roll
  // (the GM narrating it while the roller explains it) would otherwise read the
  // same list and one write would drop the other's comment.
  it('keeps comments on the serialized dispatch chain', () => {
    expect(RPC_TABLE[TM.SET_COMMENT].concurrent).toBeUndefined()
  })
})

describe('rpcDescriptor', () => {
  it('resolves a known action', () => {
    expect(rpcDescriptor(TM.ROLL_CHECK)?.handler).toBe(RPC_TABLE[TM.ROLL_CHECK].handler)
  })

  // The listener leans on undefined to mean "not a request I answer": it then
  // checks the passive set, and failing that answers with an error ack.
  it('resolves nothing for a passive, early, or unknown action', () => {
    expect(rpcDescriptor(TM.SHARE_TARGETS)).toBeUndefined()
    expect(rpcDescriptor(TM.REQUEST_CHARACTER)).toBeUndefined()
    expect(rpcDescriptor('someFutureAction')).toBeUndefined()
  })

  it('does not resolve inherited Object properties as descriptors', () => {
    // The lookup indexes a plain object by an attacker-supplied string.
    expect(rpcDescriptor('constructor')).toBeUndefined()
    expect(rpcDescriptor('toString')).toBeUndefined()
    expect(rpcDescriptor('__proto__')).toBeUndefined()
  })
})

describe('PASSIVE_ACTIONS', () => {
  // Foundry → browser only. The listener sees them on the wire and has nothing
  // to do; anything else without a table entry gets an error ack instead.
  it('is exactly the actions this side sends', () => {
    expect([...PASSIVE_ACTIONS].sort()).toEqual(
      [TM.LISTENER_ONLINE, TM.UPDATE_CHARACTER, TM.SHARE_TARGETS].sort()
    )
  })

  // ACK, REQUEST_CHARACTER, REQUEST_TARGETS and ANYBODY_HOME are answered ahead
  // of the table, each for its own reason (see setupListener), so they must not
  // be classified passive — a passive ACK would silently disable the cross-client
  // request-dedup guard.
  it('does not swallow an action the listener answers early', () => {
    for (const action of [TM.ACK, TM.REQUEST_CHARACTER, TM.REQUEST_TARGETS, TM.ANYBODY_HOME]) {
      expect(PASSIVE_ACTIONS.has(action), `${action} must not be passive`).toBe(false)
    }
  })

  it('never overlaps the table', () => {
    const overlap = [...PASSIVE_ACTIONS].filter((action) => rpcDescriptor(action))
    expect(overlap).toEqual([])
  })
})
