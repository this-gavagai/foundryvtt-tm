import { describe, it, expect, vi } from 'vitest'
import type { ActorPF2e, GamePF2e, TokenPF2e } from '@7h3laughingman/pf2e-types'
import {
  resolveTargets,
  resolveRequestedTargets,
  requirePlaceableTarget,
  withMirroredTargets,
  abandonMirroredTargets,
  noFallbackTargetActor,
  ownTargetIds
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
  // Foundry's UserTargets exposes this for reporting; broadcastOwnTargets reads
  // it (through ownTargetIds).
  get ids(): string[] {
    return Array.from(this).map((token) => (token as unknown as { name: string }).name)
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
    await withMirroredTargets(game, [], async () => {
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
    await withMirroredTargets(game, [], async () => undefined)
    expect(game.user.targets).toBe(held)
    expect(Array.from(game.user.targets)).toEqual([{ name: 'gm-reticle' }])
  })

  it('restores it when the roll throws', async () => {
    const game = makeGameWithTargets('gm-reticle')
    const held = game.user.targets
    await expect(
      withMirroredTargets(game, [], async () => {
        throw new Error('roll blew up')
      })
    ).rejects.toThrow('roll blew up')
    expect(game.user.targets).toBe(held)
  })

  // What this client tells mirroring tablets it is targeting. The swap above
  // makes `game.user.targets` lie for the duration of a roll, and the client
  // answering the roll is very often the proxy those tablets read — so every
  // report has to come from the real set, not the stand-in.
  it('reports this client own targets, not the stand-in, during a roll', async () => {
    const game = makeGameWithTargets('gm-reticle')
    const { tokens } = resolveTargets(game, { targets: ['tok-1'], targetScene: 'scene-a' })
    let reportedDuringRoll: string[] = []
    await withMirroredTargets(game, tokens, async () => {
      reportedDuringRoll = ownTargetIds(game)
    })
    expect(reportedDuringRoll).toEqual(['gm-reticle'])
  })

  it('reports an empty own selection during an untargeted roll, not the empty stand-in', async () => {
    const game = makeGameWithTargets()
    let reportedDuringRoll: string[] = ['unset']
    await withMirroredTargets(game, [], async () => {
      reportedDuringRoll = ownTargetIds(game)
    })
    expect(reportedDuringRoll).toEqual([])
  })

  it('reports the live property once the swap is over', async () => {
    const game = makeGameWithTargets('gm-reticle')
    await withMirroredTargets(game, [], async () => undefined)
    expect(ownTargetIds(game)).toEqual(['gm-reticle'])
  })

  it('keeps reporting the real set through a nested swap', async () => {
    const game = makeGameWithTargets('gm-reticle')
    const { tokens } = resolveTargets(game, { targets: ['tok-1'], targetScene: 'scene-a' })
    let reportedInside: string[] = []
    await withMirroredTargets(game, [], () =>
      withMirroredTargets(game, tokens, async () => {
        reportedInside = ownTargetIds(game)
      })
    )
    expect(reportedInside).toEqual(['gm-reticle'])
    expect(ownTargetIds(game)).toEqual(['gm-reticle'])
  })

  it('reports the real set again after a roll that threw', async () => {
    const game = makeGameWithTargets('gm-reticle')
    await expect(
      withMirroredTargets(game, [], async () => {
        throw new Error('roll blew up')
      })
    ).rejects.toThrow('roll blew up')
    expect(ownTargetIds(game)).toEqual(['gm-reticle'])
  })

  // The dispatch queue gives up on a handler that never settles
  // (HANDLER_QUEUE_TIMEOUT_MS) and lets the next request run. Everything the
  // abandoned handler owns has to come off HERE rather than in a `finally` that
  // may never run — a swap left standing means the GM's own reticle is replaced
  // by the roller's on their own screen for the rest of the session, and, because
  // the outermost frame is still recorded, ownTargetIds keeps reporting a frozen
  // pre-roll set to every tablet mirroring this client.
  it('puts this client targeting back when the queue abandons a hung roll', async () => {
    const game = makeGameWithTargets('gm-reticle')
    const held = game.user.targets
    let release: (() => void) | undefined
    const hung = withMirroredTargets(game, [], () => new Promise<void>((r) => (release = r)))

    expect(game.user.targets).not.toBe(held)
    expect(abandonMirroredTargets()).toBe(1)

    expect(game.user.targets).toBe(held)
    expect(ownTargetIds(game)).toEqual(['gm-reticle'])

    release!()
    await hung
  })

  // The sharp end of abandoning: the hung handler is still running, so its
  // `finally` fires at some arbitrary later point — by which time the queue has
  // moved on and ANOTHER request is mid-roll behind its own swap. A restore that
  // doesn't check whether its frame is still current puts the pre-abandon
  // property back and strips the live roll's targets out from under it, which
  // reads as the roll quietly aiming at the GM's reticle instead.
  it('does not strip a later roll of its targets when a hung one settles', async () => {
    const game = makeGameWithTargets('gm-reticle')
    let releaseHung: (() => void) | undefined
    const hung = withMirroredTargets(game, [], () => new Promise<void>((r) => (releaseHung = r)))
    abandonMirroredTargets()

    const { tokens } = resolveTargets(game, { targets: ['tok-1'], targetScene: 'scene-a' })
    let ambientAfterHungSettled: string[] = []
    let releaseLive: (() => void) | undefined
    const live = withMirroredTargets(game, tokens, async () => {
      await new Promise<void>((r) => (releaseLive = r))
      ambientAfterHungSettled = [
        ...(game.user.targets as unknown as Iterable<{ name: string }>)
      ].map((t) => t.name)
    })

    releaseHung!()
    await hung

    releaseLive!()
    await live
    expect(ambientAfterHungSettled).toEqual(['token-tok-1'])
  })

  it('restores the real set, not an inner stand-in, when abandoning a nested swap', async () => {
    const game = makeGameWithTargets('gm-reticle')
    const held = game.user.targets
    const { tokens } = resolveTargets(game, { targets: ['tok-1'], targetScene: 'scene-a' })
    let release: (() => void) | undefined
    const hung = withMirroredTargets(game, [], () =>
      withMirroredTargets(game, tokens, () => new Promise<void>((r) => (release = r)))
    )

    expect(abandonMirroredTargets()).toBe(2)
    expect(game.user.targets).toBe(held)

    release!()
    await hung
    expect(game.user.targets).toBe(held)
  })

  it('does nothing when no swap is in flight', () => {
    const game = makeGameWithTargets('gm-reticle')
    const held = game.user.targets
    expect(abandonMirroredTargets()).toBe(0)
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
    const ran = await withMirroredTargets(game as unknown as GamePF2e, [], async () => 'rolled')
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
