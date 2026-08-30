import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GamePF2e } from '@7h3laughingman/pf2e-types'

// What every roll ultimately aims at is `game.user.targets` on the client that
// answers the request — which is the elected GM's own reticle, usually parked on
// whatever NPC they are running. These tests pin the swap that keeps a tablet
// roll off it: the ambient set must present the PLAYER's targets for the whole
// roll, and must be exactly the GM's own again afterwards.
//
// Elemental blast is the case that matters most, because PF2e reads the ambient
// set there and ignores the `target` param entirely (ElementalBlast#attack
// builds `target: game.user.targets.first()?.actor ?? null`). A targeted blast
// with no swap rolls against the GM's reticle and looks completely normal.

vi.mock('@/utils/utilities', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() }
}))

// The orchestrator's Foundry touchpoints. getGame/getCharacter hand back the
// fakes below; the rest are inert.
const fakeEvent = { type: 'click' } as unknown as PointerEvent
vi.mock('@/foundry/utils/foundry', () => ({
  getGame: () => currentGame,
  getCharacter: () => currentActor,
  makeAck: () => ({ action: 'acknowledged' }),
  makeFakeEvent: () => fakeEvent
}))
vi.mock('@/foundry/backgroundRoll', () => ({
  withBackgroundRoll: <T>(_dice: unknown, run: () => Promise<T>) => run()
}))
vi.mock('@/foundry/utils/roll', () => ({
  extractRollPayload: (raw: unknown) => ({ raw }),
  makeCastRankEvent: () => fakeEvent
}))

import { foundryRollCheck } from '@/foundry/handlers/rollCheck'
import { resolveCapture } from '@/foundry/chatCapture'
import type { RollCheckArgs } from '@/types/api-types'

// A UserTargets stand-in: a Set the swap can re-instantiate, with the `ids` and
// `first()` accessors the module and PF2e read off it.
class FakeUserTargets extends Set<{ id: string; document: unknown }> {
  constructor(_user: unknown) {
    super()
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

// What the blast handler is handed when it rolls: whatever the ambient set held
// at that moment, which is the whole question.
let ambientDuringRoll: string[] = []

// onRoll fires at the moment the roll itself runs — the point at which PF2e
// would have created its chat card, which is what the capture test stands in for.
function makeGame(gmReticle: string[], sceneTokens: string[], onRoll?: () => void) {
  const tokens = new Map(sceneTokens.map((id) => [id, placedToken(id)]))
  const scene = {
    id: 'scene-a',
    tokens: { get: (id: string) => tokens.get(id)?.document }
  }
  const user: { targets: FakeUserTargets } = { targets: new FakeUserTargets(null) }
  for (const id of gmReticle) Set.prototype.add.call(user.targets, placedToken(id))

  return {
    user,
    scenes: { get: (id: string) => (id === 'scene-a' ? scene : undefined), active: scene },
    pf2e: {
      Modifier: class {
        constructor(m: unknown) {
          Object.assign(this, m)
        }
      },
      // Records the ambient set at roll time, the way PF2e's own blast does.
      ElementalBlast: class {
        constructor(_actor: unknown) {}
        attack() {
          ambientDuringRoll = (currentGame.user.targets as unknown as FakeUserTargets).ids
          onRoll?.()
          return Promise.resolve({ rolled: 'blast' })
        }
        damage() {
          ambientDuringRoll = (currentGame.user.targets as unknown as FakeUserTargets).ids
          return Promise.resolve({ rolled: 'blast-damage' })
        }
      }
    }
  } as unknown as GamePF2e
}

const character = {
  name: 'Kineticist',
  isOfType: (type: string) => type === 'character',
  getStatistic: () => null
}

let currentGame: GamePF2e
let currentActor: typeof character

function blastArgs(targets: string[]): RollCheckArgs {
  return {
    action: 'rollCheck',
    userId: 'player-1',
    characterId: 'kin-1',
    checkType: 'blast',
    checkSubtype: { element: 'fire', damageType: 'fire', variant: 0, isMelee: true },
    modifiers: [],
    options: {},
    targets,
    ...(targets.length ? { targetScene: 'scene-a' } : {})
  } as unknown as RollCheckArgs
}

beforeEach(() => {
  ambientDuringRoll = ['unset']
  currentActor = character
})

describe('elemental blast targeting', () => {
  it('presents the player targets to a path that only reads the ambient set', async () => {
    currentGame = makeGame(['gm-reticle'], ['tok-1'])

    await foundryRollCheck(blastArgs(['tok-1']))

    // Not ['gm-reticle'] — which is what an unswapped roll would have hit.
    expect(ambientDuringRoll).toEqual(['tok-1'])
  })

  it('hides the handling GM own reticle from an untargeted blast', async () => {
    currentGame = makeGame(['gm-reticle'], ['tok-1'])

    await foundryRollCheck(blastArgs([]))

    expect(ambientDuringRoll).toEqual([])
  })

  it('restores the GM own selection, by identity, once the roll is done', async () => {
    currentGame = makeGame(['gm-reticle'], ['tok-1'])
    const held = currentGame.user.targets

    await foundryRollCheck(blastArgs(['tok-1']))

    expect(currentGame.user.targets).toBe(held)
    expect((currentGame.user.targets as unknown as FakeUserTargets).ids).toEqual(['gm-reticle'])
  })

  it('refuses rather than rolling at the GM reticle when the target is gone', async () => {
    // The scene has no such token: our mirror of the proxy is stale. Rolling
    // anyway would produce a normal-looking card aimed at the wrong creature.
    currentGame = makeGame(['gm-reticle'], ['tok-1'])

    await expect(foundryRollCheck(blastArgs(['tok-vanished']))).rejects.toThrow()
  })
})

describe('checks that pass an explicit target', () => {
  it('leaves the ambient set alone for a skill check', async () => {
    // A statistic check always receives an actor through statisticParams, so it
    // needs no swap — and this client may be somebody's targeting proxy, whose
    // reports must keep describing the screen.
    currentGame = makeGame(['gm-reticle'], ['tok-1'])
    const held = currentGame.user.targets
    let swapped = false

    currentActor = {
      ...character,
      skills: {
        athletics: {
          check: {
            roll: () => {
              swapped = currentGame.user.targets !== held
              return Promise.resolve({ rolled: 'skill' })
            }
          }
        }
      }
    } as unknown as typeof character

    await foundryRollCheck({
      ...blastArgs(['tok-1']),
      checkType: 'skill',
      checkSubtype: { slug: 'athletics' }
    } as unknown as RollCheckArgs)

    expect(swapped).toBe(false)
  })
})

// The ack names the chat card the roll posted, which is what lets the app offer
// a comment on the roll from the result panel. PF2e's pipelines create that card
// themselves and hand back only the roll, so it is matched by request uuid — the
// listener's createChatMessage hook is what calls resolveCapture, stood in for
// here by the roll itself.
describe('the card the roll posted', () => {
  it('reports the captured message id', async () => {
    currentGame = makeGame([], ['tok-1'], () => resolveCapture('req-card', { id: 'msg-77' }))

    const ack = await foundryRollCheck({
      ...blastArgs([]),
      uuid: 'req-card'
    } as unknown as RollCheckArgs)

    expect(ack.messageId).toBe('msg-77')
  })

  it('acks without one when nothing could be matched to the request', async () => {
    // A roll that posted no card must not stall the ack waiting for one: the
    // handler settles its own capture rather than sitting out the timeout.
    currentGame = makeGame([], ['tok-1'])

    const ack = await foundryRollCheck({
      ...blastArgs([]),
      uuid: 'req-silent'
    } as unknown as RollCheckArgs)

    expect(ack.messageId).toBeUndefined()
  })
})
