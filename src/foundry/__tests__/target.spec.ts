import { describe, it, expect, vi } from 'vitest'
import type { ActorPF2e, GamePF2e, TokenPF2e } from '@7h3laughingman/pf2e-types'
import {
  resolveTargets,
  resolveRequestedTargets,
  requirePlaceableTarget,
  withMirroredTargets,
  withoutAmbientTargets,
  noFallbackTargetActor
} from '@/foundry/utils/target'
import { TM_ERROR_TARGET_UNRESOLVED } from '@/api/protocol'

vi.mock('@/utils/utilities', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() }
}))

// The tablet has no canvas, so a targeted request arrives as token ids plus the
// scene they were picked on. These tests pin the two properties that decide
// whether the right creature gets hit: ids resolve against the scene the
// TARGETING client named (not whichever scene happens to be active), and a
// request that targeted something unfindable is refused rather than rolled.

type FakeTokenDoc = { id: string; actor: object | null; object: object | null }

function scene(id: string, tokenIds: string[], drawn = true) {
  const tokens = new Map<string, FakeTokenDoc>(
    tokenIds.map((tid) => [
      tid,
      {
        id: tid,
        actor: { name: `actor-${tid}` },
        // `object` is the PLACED token, which exists only while this client has
        // that scene drawn. An undrawn scene still resolves documents.
        object: drawn ? { name: `token-${tid}` } : null
      }
    ])
  )
  return { id, tokens: { get: (tid: string) => tokens.get(tid) ?? undefined } }
}

// A world of two scenes that deliberately REUSE token id 'tok-1'. Token ids are
// unique per scene, not per world — this is the collision that made the old
// bare-id wire format ambiguous.
function makeGame(activeId: string | null) {
  const scenes = new Map([
    ['scene-a', scene('scene-a', ['tok-1', 'tok-2'])],
    ['scene-b', scene('scene-b', ['tok-1'])],
    // A scene this client holds documents for but has not drawn — what the
    // elected GM sees when the targeting proxy is on a different scene.
    ['scene-elsewhere', scene('scene-elsewhere', ['tok-far'], false)]
  ])
  return {
    scenes: {
      get: (id: string) => scenes.get(id),
      active: activeId ? scenes.get(activeId) : null
    }
  } as unknown as GamePF2e
}

// Stand-in for Foundry's UserTargets: a Set subclass hung off the User document,
// whose add() refreshes the token's reticle (recorded here so we can prove we
// never call it — presenting the player's targets must not touch the UI).
class FakeUserTargets extends Set<TokenPF2e> {
  static reticleRefreshes = 0
  constructor(readonly user: unknown) {
    super()
  }
  override add(token: TokenPF2e): this {
    FakeUserTargets.reticleRefreshes++
    return super.add(token)
  }
}

function makeGameWithTargets(...ownTargets: string[]) {
  const user = {} as { targets: FakeUserTargets }
  user.targets = new FakeUserTargets(user)
  for (const name of ownTargets) {
    Set.prototype.add.call(user.targets, { name } as unknown as TokenPF2e)
  }
  const game = makeGame('scene-a') as unknown as { user: typeof user }
  game.user = user
  return game as unknown as GamePF2e
}

describe('resolveTargets scene selection', () => {
  it('resolves against the scene the request names, not the active one', () => {
    const game = makeGame('scene-a')
    const resolved = resolveTargets(game, { targets: ['tok-1'], targetScene: 'scene-b' })
    // Same id exists on both scenes; only the named scene's token is correct.
    expect(resolved.tokenDoc?.object).toEqual({ name: 'token-tok-1' })
    expect(resolved.unresolved).toEqual([])
  })

  it('falls back to the active scene when no scene is named (pre-protocol-4 app)', () => {
    const game = makeGame('scene-a')
    const resolved = resolveTargets(game, { targets: ['tok-2'] })
    expect(resolved.tokenDocs).toHaveLength(1)
  })

  it('resolves nothing when the named scene is unknown, rather than retrying the active one', () => {
    // A blind retry on the active scene would find ITS 'tok-1' and silently
    // target a different creature.
    const game = makeGame('scene-a')
    const resolved = resolveTargets(game, { targets: ['tok-1'], targetScene: 'scene-gone' })
    expect(resolved.tokenDocs).toEqual([])
    expect(resolved.unresolved).toEqual(['tok-1'])
  })

  it('resolves nothing when no scene is named and none is active', () => {
    const resolved = resolveTargets(makeGame(null), { targets: ['tok-1'] })
    expect(resolved.tokenDocs).toEqual([])
  })
})

describe('resolveTargets multi-target', () => {
  it('keeps every resolved target, not just the first', () => {
    const game = makeGame('scene-a')
    const resolved = resolveTargets(game, {
      targets: ['tok-1', 'tok-2'],
      targetScene: 'scene-a'
    })
    expect(resolved.tokenDocs).toHaveLength(2)
    expect(resolved.tokens).toHaveLength(2)
    // The single-target conveniences are the FIRST of the list, so PF2e paths
    // that take one target stay unchanged.
    expect(resolved.tokenDoc).toBe(resolved.tokenDocs[0])
    expect(resolved.token).toBe(resolved.tokens[0])
  })

  it('reports partial losses instead of hiding them behind a shorter list', () => {
    const game = makeGame('scene-a')
    const resolved = resolveTargets(game, {
      targets: ['tok-1', 'ghost', 'tok-2'],
      targetScene: 'scene-a'
    })
    expect(resolved.requested).toBe(3)
    expect(resolved.tokenDocs).toHaveLength(2)
    expect(resolved.unresolved).toEqual(['ghost'])
  })

  it('proxies getActiveTokens on the first target so PF2e never reads game.user.targets', () => {
    const game = makeGame('scene-a')
    const { actorProxy } = resolveTargets(game, { targets: ['tok-1'], targetScene: 'scene-a' })
    const asActor = actorProxy as unknown as {
      getActiveTokens: (linked?: boolean, doc?: boolean) => unknown[]
    }
    expect(asActor.getActiveTokens(false, false)).toEqual([{ name: 'token-tok-1' }])
    expect(asActor.getActiveTokens(false, true)).toHaveLength(1)
  })
})

describe('resolveRequestedTargets refusal', () => {
  it('refuses when the player targeted something and none of it resolves', () => {
    const game = makeGame('scene-a')
    expect(() =>
      resolveRequestedTargets(game, { targets: ['ghost'], targetScene: 'scene-a' })
    ).toThrow(TM_ERROR_TARGET_UNRESOLVED)
  })

  it('refuses a stale mirror pointing at a scene that is gone', () => {
    const game = makeGame('scene-a')
    expect(() =>
      resolveRequestedTargets(game, { targets: ['tok-1'], targetScene: 'scene-gone' })
    ).toThrow(TM_ERROR_TARGET_UNRESOLVED)
  })

  it('allows an untargeted request through — no targets is not a failure', () => {
    const game = makeGame('scene-a')
    expect(resolveRequestedTargets(game, { targets: [] }).tokenDoc).toBeNull()
    expect(resolveRequestedTargets(game, {}).requested).toBe(0)
  })

  it('allows a partial resolution through rather than losing the whole roll', () => {
    const game = makeGame('scene-a')
    const resolved = resolveRequestedTargets(game, {
      targets: ['tok-1', 'ghost'],
      targetScene: 'scene-a'
    })
    expect(resolved.tokenDocs).toHaveLength(1)
    expect(resolved.unresolved).toEqual(['ghost'])
  })
})

// Strikes, their damage rolls and blasts take a PLACED Token, not an actor. A
// document alone is not enough for them, and rolling anyway lets PF2e substitute
// the handling client's own reticle.
describe('requirePlaceableTarget', () => {
  it('refuses when the target resolved as a document but this client has no placed token', () => {
    const game = makeGame('scene-a')
    const resolved = resolveRequestedTargets(game, {
      targets: ['tok-far'],
      targetScene: 'scene-elsewhere'
    })
    // The document resolved, so the generic refusal passed it through...
    expect(resolved.tokenDocs).toHaveLength(1)
    expect(resolved.token).toBeNull()
    // ...and this is the check that catches it.
    expect(() => requirePlaceableTarget(resolved)).toThrow(TM_ERROR_TARGET_UNRESOLVED)
  })

  it('passes a placed target through untouched', () => {
    const game = makeGame('scene-a')
    const resolved = resolveRequestedTargets(game, { targets: ['tok-1'], targetScene: 'scene-a' })
    expect(requirePlaceableTarget(resolved)).toBe(resolved)
  })

  it('allows an untargeted request — nothing was asked for, so nothing is missing', () => {
    const resolved = resolveRequestedTargets(makeGame('scene-a'), { targets: [] })
    expect(() => requirePlaceableTarget(resolved)).not.toThrow()
  })
})

// The handling client is usually a GM with their own token targeted for their own
// NPC turns. PF2e reads that selection whenever a roll arrives without a target,
// so a tablet roll would silently borrow it.
describe('mirroring targets onto the handling client', () => {
  it('hides this client own targets from an untargeted roll', async () => {
    const game = makeGameWithTargets('gm-reticle')
    let seenDuringRoll: unknown[] = []
    await withoutAmbientTargets(game, async () => {
      seenDuringRoll = Array.from(game.user.targets)
    })
    expect(seenDuringRoll).toEqual([])
  })

  it('presents the player targets to paths that only read game.user.targets', async () => {
    const game = makeGameWithTargets('gm-reticle')
    const { tokens } = resolveTargets(game, { targets: ['tok-1'], targetScene: 'scene-a' })
    let seenDuringRoll: unknown[] = []
    await withMirroredTargets(game, tokens, async () => {
      seenDuringRoll = Array.from(game.user.targets)
    })
    expect(seenDuringRoll).toEqual([{ name: 'token-tok-1' }])
  })

  it('never draws a reticle: membership bypasses UserTargets#add', async () => {
    const game = makeGameWithTargets('gm-reticle')
    const { tokens } = resolveTargets(game, { targets: ['tok-1'], targetScene: 'scene-a' })
    FakeUserTargets.reticleRefreshes = 0
    await withMirroredTargets(game, tokens, async () => undefined)
    expect(FakeUserTargets.reticleRefreshes).toBe(0)
  })

  it('restores the exact original set afterwards, by identity', async () => {
    const game = makeGameWithTargets('gm-reticle')
    const held = game.user.targets
    await withoutAmbientTargets(game, async () => undefined)
    expect(game.user.targets).toBe(held)
    expect(Array.from(game.user.targets)).toEqual([{ name: 'gm-reticle' }])
  })

  it('restores it when the roll throws', async () => {
    const game = makeGameWithTargets('gm-reticle')
    const held = game.user.targets
    await expect(
      withoutAmbientTargets(game, async () => {
        throw new Error('roll blew up')
      })
    ).rejects.toThrow('roll blew up')
    expect(game.user.targets).toBe(held)
  })

  it('rolls unshielded rather than break targeting it cannot put back', async () => {
    const game = makeGame('scene-a') as unknown as { user: object }
    // A prototype getter, not an own value property — nothing safe to swap.
    game.user = Object.create({
      get targets() {
        return new Set(['immovable'])
      }
    }) as object
    const ran = await withoutAmbientTargets(game as unknown as GamePF2e, async () => 'rolled')
    expect(ran).toBe('rolled')
  })
})

describe('noFallbackTargetActor', () => {
  const standIn = () =>
    noFallbackTargetActor({
      level: 12,
      getSelfRollOptions: () => ['self:level:12'],
      getActiveTokens: () => ['a real token'],
      name: 'Roller'
    } as unknown as ActorPF2e) as unknown as {
      level: number
      name: string
      getSelfRollOptions: () => string[]
      getActiveTokens: (linked?: boolean, doc?: boolean) => unknown[]
    }

  it('resolves to no token, so PF2e stops looking instead of reading game.user.targets', () => {
    expect(standIn().getActiveTokens(true, false)).toEqual([])
    expect(
      standIn()
        .getActiveTokens(true, true)
        .find(() => true)
    ).toBeFalsy()
  })

  it('contributes no roll options and no level', () => {
    // Level 0 keeps a non-existent target from earning an incapacitation
    // degree-of-success adjustment off the ROLLER's level.
    expect(standIn().getSelfRollOptions()).toEqual([])
    expect(standIn().level).toBe(0)
  })

  it('passes everything else through', () => {
    expect(standIn().name).toBe('Roller')
  })
})
