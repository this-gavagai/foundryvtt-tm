import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GamePF2e } from '@7h3laughingman/pf2e-types'

// A character action runs through PF2e's `game.pf2e.actions.get(slug).use()`,
// which resolves its target in two steps:
//
//   SingleCheckActionVariant#use  passes a `target` CALLBACK down, answering
//                                null unless options.target is an Actor/Token
//   simpleRollActionCheck         `e.target?.() ?? ActionMacroHelpers.target()`
//
// and ActionMacroHelpers.target() is a bare `Array.from(game.user.targets)` read
// (pf2e 8.4.1). So the actor proxy this handler passes covers the TARGETED case
// and nothing else: with no target the callback answers null and the action rolls
// against whatever the elected GM happens to be pointing at — a normal-looking
// card, aimed at the wrong creature.
//
// The identical use() path in handlers/checks/statistic.ts (handleSkillAction)
// has always been shielded. These pin that this one is too.

vi.mock('@/utils/utilities', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() }
}))

const fakeEvent = { type: 'click' } as unknown as PointerEvent
vi.mock('@/foundry/utils/foundry', () => ({
  getGame: () => currentGame,
  makeAck: () => ({ action: 'acknowledged' }),
  makeFakeEvent: () => fakeEvent
}))
vi.mock('@/foundry/backgroundRoll', () => ({
  withBackgroundRoll: <T>(_dice: unknown, run: () => Promise<T>) => run()
}))
vi.mock('@/foundry/utils/roll', () => ({
  extractRollPayload: (raw: unknown) => ({ raw }),
  rollClass: () => class {}
}))

import { foundryCharacterAction } from '@/foundry/handlers/actionHandlers'
import type { CharacterActionArgs } from '@/types/api-types'

// The `already has a targets set` guard is core's, verbatim (foundry 14.367,
// client/canvas/placeables/tokens/targets.mjs). Faithful on purpose: without it
// the swap under test throws in production and silently rolls unshielded, while
// a permissive double reports every one of these as passing.
class FakeUserTargets extends Set<{ id: string; document: unknown }> {
  constructor(user: unknown) {
    super()
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

// What ActionMacroHelpers.target() would have seen at the moment the action ran.
let ambientDuringUse: string[] = []
// And what the handler passed explicitly, which covers the targeted case.
let targetParamDuringUse: unknown

const actor = { _id: 'char-1', name: 'Ezren', skills: {}, saves: {} }

function makeGame(gmReticle: string[], sceneTokens: string[]) {
  const tokens = new Map(sceneTokens.map((id) => [id, placedToken(id)]))
  const scene = { id: 'scene-a', tokens: { get: (id: string) => tokens.get(id)?.document } }
  const user: { targets: FakeUserTargets } = { targets: new FakeUserTargets(null) }
  for (const id of gmReticle) Set.prototype.add.call(user.targets, placedToken(id))

  return {
    user,
    actors: { get: () => actor },
    scenes: { get: (id: string) => (id === 'scene-a' ? scene : undefined), active: scene },
    pf2e: {
      Modifier: class {},
      actions: {
        get: (slug: string) =>
          slug === 'demoralize'
            ? {
                use: (params: { target?: unknown }) => {
                  ambientDuringUse = (currentGame.user.targets as unknown as FakeUserTargets).ids
                  targetParamDuringUse = params.target
                  return Promise.resolve([{ roll: { total: 17 } }])
                }
              }
            : undefined
      }
    }
  } as unknown as GamePF2e
}

let currentGame: GamePF2e

function actionArgs(targets: string[]): CharacterActionArgs {
  return {
    action: 'characterAction',
    userId: 'player-1',
    characterId: 'char-1',
    characterAction: 'demoralize',
    diceResults: {},
    options: {},
    targets,
    ...(targets.length ? { targetScene: 'scene-a' } : {}),
    uuid: 'req-1'
  } as unknown as CharacterActionArgs
}

beforeEach(() => {
  ambientDuringUse = ['unset']
  targetParamDuringUse = 'unset'
})

describe('character actions and the handling GM reticle', () => {
  it('hides the GM own reticle from an untargeted action', async () => {
    currentGame = makeGame(['gm-reticle'], ['tok-1'])

    await foundryCharacterAction(actionArgs([]))

    // Not ['gm-reticle']: ActionMacroHelpers.target() has nothing to find.
    expect(ambientDuringUse).toEqual([])
    expect(targetParamDuringUse).toBeUndefined()
  })

  it('presents the player targets to the ambient read as well as the param', async () => {
    currentGame = makeGame(['gm-reticle'], ['tok-1'])

    await foundryCharacterAction(actionArgs(['tok-1']))

    expect(ambientDuringUse).toEqual(['tok-1'])
    // The actor proxy still goes in explicitly — the mirror is the backstop for
    // the paths that ignore it, not a replacement for it.
    expect(targetParamDuringUse).toBeTruthy()
  })

  it('restores the GM own selection, by identity, once the action is done', async () => {
    currentGame = makeGame(['gm-reticle'], ['tok-1'])
    const held = currentGame.user.targets

    await foundryCharacterAction(actionArgs(['tok-1']))

    expect(currentGame.user.targets).toBe(held)
    expect((currentGame.user.targets as unknown as FakeUserTargets).ids).toEqual(['gm-reticle'])
  })

  it('refuses a stale mirror rather than rolling at the GM reticle', async () => {
    // The named token is not on the scene: our copy of the proxy's targeting is
    // out of date. resolveRequestedTargets refuses, and the app resyncs.
    currentGame = makeGame(['gm-reticle'], ['tok-1'])

    await expect(foundryCharacterAction(actionArgs(['tok-vanished']))).rejects.toThrow()
  })
})
