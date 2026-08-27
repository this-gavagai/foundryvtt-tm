import { describe, it, expect, vi } from 'vitest'
import type { ModuleEventArgs } from '@/types/api-types'
import {
  authorizeRequest,
  targetActorId,
  userOwnsActor,
  userOwnsActorById,
  type ActorLike,
  type AuthWorld
} from '@/foundry/rpcAuthorize'

// The gate every client-initiated RPC passes through before its handler runs on
// the GM's client with GM privileges. `args.userId` is self-reported and can't be
// authenticated over Foundry's module channel, so what these tests pin is the one
// thing the gate *can* guarantee: a request never reaches a handler for an actor
// its requester doesn't own, and an action with no declared requirement is
// refused rather than waved through.

const OWNER = 3
const OBSERVER = 2

type FakeUser = { isGM?: boolean }

// A world of users and actors, with call counters so a test can assert that the
// 'world-user' path never touches actors at all.
function makeWorld(
  users: Record<string, FakeUser>,
  actors: Record<string, ActorLike> = {}
): AuthWorld & { userLookups: string[]; actorLookups: string[] } {
  const userLookups: string[] = []
  const actorLookups: string[] = []
  return {
    userLookups,
    actorLookups,
    users: {
      get: (id: string) => {
        userLookups.push(id)
        return users[id]
      }
    },
    actors: {
      get: (id: string) => {
        actorLookups.push(id)
        return actors[id]
      }
    }
  }
}

// A request as it arrives on the wire. Only the fields the gate reads matter.
const request = (fields: Record<string, unknown>) =>
  ({ action: 'rollCheck', uuid: 'req-1', ...fields }) as ModuleEventArgs

// An actor that answers through Foundry's canonical permission test.
const withPermissionTest = (allow: (user: unknown) => boolean): ActorLike => ({
  testUserPermission: vi.fn((user: unknown, level: string | number) => {
    expect(level).toBe('OWNER')
    return allow(user)
  })
})

describe('targetActorId', () => {
  it('reads actorId, then characterId', () => {
    expect(targetActorId(request({ actorId: 'act-1' }))).toBe('act-1')
    expect(targetActorId(request({ characterId: 'chr-1' }))).toBe('chr-1')
  })

  it('prefers actorId when a request carries both', () => {
    expect(targetActorId(request({ actorId: 'act-1', characterId: 'chr-1' }))).toBe('act-1')
  })

  it('ignores non-string ids and reports none when neither is present', () => {
    expect(targetActorId(request({ actorId: 42, characterId: 'chr-1' }))).toBe('chr-1')
    expect(targetActorId(request({ actorId: null }))).toBeUndefined()
    expect(targetActorId(request({}))).toBeUndefined()
  })
})

describe('userOwnsActor', () => {
  it('denies an actor that does not exist', () => {
    const world = makeWorld({ 'usr-1': {} })
    expect(userOwnsActor(world, undefined, 'usr-1')).toBe(false)
    expect(userOwnsActor(world, null, 'usr-1')).toBe(false)
  })

  it('denies a user this world does not know', () => {
    const world = makeWorld({})
    expect(userOwnsActor(world, { ownership: { 'usr-1': OWNER } }, 'usr-1')).toBe(false)
  })

  // A GM owns every actor in the world. Stated up front so the ownership-map
  // fallback can't deny a GM who owns nothing explicitly.
  it('grants a GM an actor they own nothing of', () => {
    const world = makeWorld({ gm: { isGM: true } })
    expect(userOwnsActor(world, { ownership: {} }, 'gm')).toBe(true)
    expect(userOwnsActor(world, {}, 'gm')).toBe(true)
  })

  it("prefers Foundry's own permission test when the actor exposes one", () => {
    const world = makeWorld({ 'usr-1': {} })
    // The map says OWNER and the permission test says no: the test wins, because
    // it is the call that honours default ownership, ownership overrides, and
    // whatever else core decides OWNER means.
    const actor: ActorLike = {
      ...withPermissionTest(() => false),
      ownership: { 'usr-1': OWNER }
    }
    expect(userOwnsActor(world, actor, 'usr-1')).toBe(false)
    expect(actor.testUserPermission).toHaveBeenCalledTimes(1)

    expect(
      userOwnsActor(
        world,
        withPermissionTest(() => true),
        'usr-1'
      )
    ).toBe(true)
  })

  it('passes the resolved User document to the permission test, not the id', () => {
    const alice = { isGM: false }
    const world = makeWorld({ 'usr-1': alice })
    const actor = withPermissionTest((user) => user === alice)
    expect(userOwnsActor(world, actor, 'usr-1')).toBe(true)
  })

  describe('ownership-map fallback (no testUserPermission)', () => {
    const world = makeWorld({ 'usr-1': {} })

    it('grants an explicit OWNER entry and denies anything below it', () => {
      expect(userOwnsActor(world, { ownership: { 'usr-1': OWNER } }, 'usr-1')).toBe(true)
      expect(userOwnsActor(world, { ownership: { 'usr-1': OBSERVER } }, 'usr-1')).toBe(false)
    })

    // An actor shared with the table via ownership.default is genuinely owned by
    // every player — this is the case the explicit-entry-only read would miss.
    it('honours ownership.default when the user has no entry of their own', () => {
      expect(userOwnsActor(world, { ownership: { default: OWNER } }, 'usr-1')).toBe(true)
      expect(userOwnsActor(world, { ownership: { default: OBSERVER } }, 'usr-1')).toBe(false)
    })

    it("lets a user's own entry override a permissive default", () => {
      const actor = { ownership: { default: OWNER, 'usr-1': OBSERVER } }
      expect(userOwnsActor(world, actor, 'usr-1')).toBe(false)
    })

    it('denies when the actor carries no ownership at all', () => {
      expect(userOwnsActor(world, {}, 'usr-1')).toBe(false)
    })
  })
})

describe('userOwnsActorById', () => {
  it('resolves the actor from the world and applies the ownership rule', () => {
    const world = makeWorld({ 'usr-1': {} }, { 'act-1': { ownership: { 'usr-1': OWNER } } })
    expect(userOwnsActorById(world, 'act-1', 'usr-1')).toBe(true)
    expect(userOwnsActorById(world, 'act-missing', 'usr-1')).toBe(false)
  })

  it('denies a blank or absent id without looking anything up', () => {
    const world = makeWorld({ gm: { isGM: true } })
    expect(userOwnsActorById(world, '', 'gm')).toBe(false)
    expect(userOwnsActorById(world, undefined, 'gm')).toBe(false)
    expect(userOwnsActorById(world, null, 'gm')).toBe(false)
    expect(world.actorLookups).toEqual([])
  })
})

describe('authorizeRequest', () => {
  // Fail-closed. rpcTable.ts makes a missing requirement a compile error, so this
  // is the runtime backstop for an action that reaches the gate anyway.
  it('denies an action with no declared requirement', () => {
    const world = makeWorld({ gm: { isGM: true } }, { 'act-1': {} })
    expect(authorizeRequest(world, undefined, request({ userId: 'gm', actorId: 'act-1' }))).toBe(
      false
    )
  })

  describe("'world-user'", () => {
    it('grants any user this world knows', () => {
      const world = makeWorld({ 'usr-1': {} })
      expect(authorizeRequest(world, 'world-user', request({ userId: 'usr-1' }))).toBe(true)
    })

    it('denies an unknown user', () => {
      const world = makeWorld({})
      expect(authorizeRequest(world, 'world-user', request({ userId: 'nobody' }))).toBe(false)
    })

    // These actions have no target actor by definition (compendium browsing,
    // reactions, push registration) — resolving one would be meaningless, and
    // requiring one would deny them outright.
    it('never consults actors, even when the request names one', () => {
      const world = makeWorld({ 'usr-1': {} }, { 'act-1': {} })
      expect(
        authorizeRequest(world, 'world-user', request({ userId: 'usr-1', characterId: 'act-1' }))
      ).toBe(true)
      expect(world.actorLookups).toEqual([])
    })
  })

  describe("'owner'", () => {
    const world = () =>
      makeWorld(
        { 'usr-1': {}, 'usr-2': {}, gm: { isGM: true } },
        {
          'act-1': { ownership: { 'usr-1': OWNER } },
          'act-shared': { ownership: { default: OWNER } }
        }
      )

    it('grants the owner of the named character', () => {
      expect(
        authorizeRequest(world(), 'owner', request({ userId: 'usr-1', characterId: 'act-1' }))
      ).toBe(true)
    })

    // The gap this gate was added to close: every characterId-keyed action —
    // nearly all of them — used to be ungated, so one player could roll, cast,
    // spend, and post chat as another player's character.
    it("denies a user rolling for someone else's character", () => {
      expect(
        authorizeRequest(world(), 'owner', request({ userId: 'usr-2', characterId: 'act-1' }))
      ).toBe(false)
    })

    it('accepts either spelling of the target id', () => {
      expect(
        authorizeRequest(world(), 'owner', request({ userId: 'usr-1', actorId: 'act-1' }))
      ).toBe(true)
    })

    it('denies a request that names no actor at all', () => {
      expect(authorizeRequest(world(), 'owner', request({ userId: 'usr-1' }))).toBe(false)
      expect(authorizeRequest(world(), 'owner', request({ userId: 'gm' }))).toBe(false)
    })

    it('denies an unknown user and an unknown actor — a GM included', () => {
      expect(
        authorizeRequest(world(), 'owner', request({ userId: 'nobody', characterId: 'act-1' }))
      ).toBe(false)
      expect(
        authorizeRequest(world(), 'owner', request({ userId: 'gm', characterId: 'gone' }))
      ).toBe(false)
    })

    it('grants a GM any actor that exists', () => {
      expect(
        authorizeRequest(world(), 'owner', request({ userId: 'gm', characterId: 'act-1' }))
      ).toBe(true)
    })

    it('grants an actor shared with the table through ownership.default', () => {
      expect(
        authorizeRequest(world(), 'owner', request({ userId: 'usr-2', characterId: 'act-shared' }))
      ).toBe(true)
    })
  })
})
