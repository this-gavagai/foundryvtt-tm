import { describe, it, expect, vi } from 'vitest'
import type { GamePF2e } from '@7h3laughingman/pf2e-types'
import { resolveTargets, resolveRequestedTargets } from '@/foundry/utils/target'
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

function scene(id: string, tokenIds: string[]) {
  const tokens = new Map<string, FakeTokenDoc>(
    tokenIds.map((tid) => [
      tid,
      { id: tid, actor: { name: `actor-${tid}` }, object: { name: `token-${tid}` } }
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
    ['scene-b', scene('scene-b', ['tok-1'])]
  ])
  return {
    scenes: {
      get: (id: string) => scenes.get(id),
      active: activeId ? scenes.get(activeId) : null
    }
  } as unknown as GamePF2e
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
