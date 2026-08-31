import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GamePF2e } from '@7h3laughingman/pf2e-types'

// A macro runs on the elected GM's client with GM privileges, so `game.user`
// inside it is the GM, not the tablet user. runActionable already substitutes
// `user.character` for exactly that reason; `user.targets` is the same
// substitution and was missing.
//
// The gap was worse than the old comment ("macros that read game.user.targets
// won't see the tablet's selection") admitted: an unshielded macro didn't see
// NOTHING, it saw the handling GM's own reticle and acted on it. Community and
// toolbelt macros are overwhelmingly written against the ambient set, so this
// was the likeliest path in the module to hit the wrong creature while looking
// entirely correct.

vi.mock('@/utils/utilities', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() }
}))
vi.mock('@/foundry/utils/foundry', () => ({
  getGame: () => currentGame,
  makeAck: () => ({ action: 'acknowledged' }),
  actorSpeaker: () => ({})
}))
vi.mock('@/foundry/globals', () => ({
  resolveUuid: async () => currentMacro,
  chatMessageClass: () => class {}
}))
vi.mock('@/foundry/utils/permissions', () => ({
  getRequestingUser: () => ({ id: 'player-1' }),
  userCanRunMacro: () => true
}))

import { foundryRunMacro } from '@/foundry/handlers/runMacro'
import type { RunMacroArgs } from '@/types/api-types'

class FakeUserTargets extends Set<{ id: string; document: unknown }> {
  constructor(user: unknown) {
    super()
    // Core's guard, verbatim — see the note in __tests__/target.spec.ts.
    if ((user as { targets?: unknown } | null)?.targets) {
      throw new Error('User already has a targets set defined')
    }
  }
  get ids() {
    return [...this].map((t) => t.id)
  }
  first() {
    return [...this][0] ?? null
  }
}

type FakeToken = { id: string; document: unknown }
function placedToken(id: string): FakeToken {
  const token: FakeToken = { id, document: null }
  token.document = { id, object: token, actor: { name: `actor-${id}` } }
  return token
}

// What a macro reading the ambient set would have acted on, and what it was
// handed through its own scope.
let ambientDuringMacro: string[] = []
let scopeDuringMacro: { token?: string; targets?: string[] } = {}

const currentMacro = {
  execute: (scope: { token?: FakeToken; targets?: FakeToken[] }) => {
    ambientDuringMacro = (currentGame.user.targets as unknown as FakeUserTargets).ids
    scopeDuringMacro = {
      token: scope.token?.id,
      targets: (scope.targets ?? []).map((t) => t.id)
    }
    return Promise.resolve('ran')
  }
}

function makeGame(gmReticle: string[], sceneTokens: string[]) {
  const tokens = new Map(sceneTokens.map((id) => [id, placedToken(id)]))
  const scene = { id: 'scene-a', tokens: { get: (id: string) => tokens.get(id)?.document } }
  const user: { targets: FakeUserTargets } = { targets: new FakeUserTargets(null) }
  for (const id of gmReticle) Set.prototype.add.call(user.targets, placedToken(id))
  return {
    user,
    actors: { get: () => ({ _id: 'char-1', name: 'Ezren' }) },
    scenes: { get: (id: string) => (id === 'scene-a' ? scene : undefined), active: scene }
  } as unknown as GamePF2e
}

let currentGame: GamePF2e

function macroArgs(targets: string[]): RunMacroArgs {
  return {
    action: 'runMacro',
    userId: 'player-1',
    characterId: 'char-1',
    macroUuid: 'Macro.abc',
    targets,
    ...(targets.length ? { targetScene: 'scene-a' } : {}),
    uuid: 'req-1'
  } as unknown as RunMacroArgs
}

beforeEach(() => {
  ambientDuringMacro = ['unset']
  scopeDuringMacro = {}
})

describe('a macro and the handling GM reticle', () => {
  it('presents the player targets to a macro that reads the ambient set', async () => {
    currentGame = makeGame(['gm-reticle'], ['tok-1'])

    await foundryRunMacro(macroArgs(['tok-1']))

    // Not ['gm-reticle'] — which is what the macro acted on before.
    expect(ambientDuringMacro).toEqual(['tok-1'])
    expect(scopeDuringMacro).toEqual({ token: 'tok-1', targets: ['tok-1'] })
  })

  it('hides the GM own reticle from an untargeted macro', async () => {
    currentGame = makeGame(['gm-reticle'], ['tok-1'])

    await foundryRunMacro(macroArgs([]))

    expect(ambientDuringMacro).toEqual([])
    expect(scopeDuringMacro).toEqual({ token: undefined, targets: [] })
  })

  it('restores the GM own selection, by identity, once the macro is done', async () => {
    currentGame = makeGame(['gm-reticle'], ['tok-1'])
    const held = currentGame.user.targets

    await foundryRunMacro(macroArgs(['tok-1']))

    expect(currentGame.user.targets).toBe(held)
    expect((currentGame.user.targets as unknown as FakeUserTargets).ids).toEqual(['gm-reticle'])
  })

  it('refuses a stale mirror rather than running the macro at the GM reticle', async () => {
    currentGame = makeGame(['gm-reticle'], ['tok-1'])

    await expect(foundryRunMacro(macroArgs(['tok-vanished']))).rejects.toThrow()
    expect(scopeDuringMacro).toEqual({})
  })
})
