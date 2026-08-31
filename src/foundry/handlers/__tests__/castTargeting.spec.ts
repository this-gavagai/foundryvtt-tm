import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GamePF2e } from '@7h3laughingman/pf2e-types'

// A cast is the one targeted request that costs something. It used to stamp the
// raw wire target ids onto its chat card without resolving them, so it was also
// the one targeted path that never refused a stale mirror: the slot was spent,
// the card came out looking targeted, and every attack/damage button on it
// silently resolved to nothing when someone later clicked it.
//
// Resolution now runs BEFORE the cast, so a stale mirror refuses while the slot
// is still unspent, and the card carries only ids that actually resolved.

vi.mock('@/utils/utilities', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() }
}))
vi.mock('@/foundry/utils/foundry', () => ({
  getGame: () => currentGame,
  makeAck: () => ({ action: 'acknowledged' })
}))
vi.mock('@/foundry/chatCapture', () => ({
  registerCapture: () => Promise.resolve(undefined)
}))
vi.mock('@/foundry/handlers/spellVariant', () => ({
  applySpellVariantToCard: vi.fn(),
  spellCardOf: vi.fn()
}))
vi.mock('@/foundry/globals', () => ({
  hooks: () => ({ on: () => 1, off: () => undefined })
}))

import { foundryCastSpell } from '@/foundry/handlers/castSpell'
import type { CastSpellArgs } from '@/types/api-types'

// Did the slot actually get spent?
let castsPerformed = 0

function tokenDoc(id: string, hasActor = true) {
  const doc: Record<string, unknown> = { id, actor: hasActor ? { name: `actor-${id}` } : null }
  doc.object = { id, document: doc }
  return doc
}

function makeGame(sceneTokens: Array<[string, boolean]>) {
  const tokens = new Map(sceneTokens.map(([id, hasActor]) => [id, tokenDoc(id, hasActor)]))
  const scene = { id: 'scene-a', tokens: { get: (id: string) => tokens.get(id) } }
  const entry = { cast: () => (castsPerformed++, Promise.resolve()) }
  const spell = { uuid: 'Item.spell-1', id: 'spell-1', system: { location: { value: 'entry-1' } } }
  return {
    scenes: { get: (id: string) => (id === 'scene-a' ? scene : undefined), active: scene },
    actors: {
      get: () => ({
        id: 'char-1',
        items: { get: (id: string) => (id === 'spell-1' ? spell : entry) }
      })
    }
  } as unknown as GamePF2e
}

let currentGame: GamePF2e

function castArgs(targets: string[]): CastSpellArgs {
  return {
    action: 'castSpell',
    userId: 'player-1',
    characterId: 'char-1',
    id: 'spell-1',
    rank: 1,
    slotId: 0,
    targets,
    ...(targets.length ? { targetScene: 'scene-a' } : {}),
    uuid: 'req-1'
  } as unknown as CastSpellArgs
}

beforeEach(() => {
  castsPerformed = 0
})

describe('a cast whose targets no longer resolve', () => {
  it('refuses before the slot is spent', async () => {
    currentGame = makeGame([['tok-1', true]])

    await expect(foundryCastSpell(castArgs(['tok-vanished']))).rejects.toThrow()
    // The whole point of resolving first: nothing was consumed.
    expect(castsPerformed).toBe(0)
  })

  it('refuses a target whose actor has been deleted', async () => {
    // An orphaned token resolves as a document and has a placeable, so it used to
    // pass every check and produce a card aimed at something that can never
    // contribute a target. See utils/target.ts.
    currentGame = makeGame([['orphan', false]])

    await expect(foundryCastSpell(castArgs(['orphan']))).rejects.toThrow()
    expect(castsPerformed).toBe(0)
  })

  it('casts normally when the targets are good', async () => {
    currentGame = makeGame([['tok-1', true]])

    await foundryCastSpell(castArgs(['tok-1']))

    expect(castsPerformed).toBe(1)
  })

  it('casts normally with no targets at all', async () => {
    currentGame = makeGame([['tok-1', true]])

    await foundryCastSpell(castArgs([]))

    expect(castsPerformed).toBe(1)
  })
})
