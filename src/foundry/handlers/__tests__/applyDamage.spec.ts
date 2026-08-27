import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TM } from '@/api/protocol'
import type { ApplyDamageArgs } from '@/types/api-types'

// Which token damage lands on. The request carries only the character applying
// it (ApplyDamageArgs has no target list), and PF2e requires a token document,
// so the handler has to find one for that actor — and must keep finding one when
// the elected GM is looking at a different scene than the player is, which is
// most of the time in play.

type FakeToken = { id: string; actorLink: boolean }

const applyDamage = vi.fn<(params: Record<string, unknown>) => Promise<object>>(async () => ({}))

// A world actor with tokens on two scenes: `drawn` are the ones this client has a
// canvas for, `elsewhere` exist only as documents on other scenes.
function makeActor(opts: { drawn?: FakeToken[]; elsewhere?: FakeToken[] } = {}) {
  const drawn = opts.drawn ?? []
  const elsewhere = opts.elsewhere ?? []
  return {
    name: 'Seelah',
    _id: 'seelah-id',
    applyDamage,
    // Mirrors core: the DRAWN scene only, filtered by `linked` when asked.
    getActiveTokens: vi.fn((linked = false) => (linked ? drawn.filter((t) => t.actorLink) : drawn)),
    // Mirrors core: every scene this actor has tokens on.
    getDependentTokens: vi.fn(() => [...drawn, ...elsewhere])
  }
}

let actor = makeActor()
const messages = new Map<string, { rolls?: unknown[] }>()

vi.mock('@/foundry/utils/foundry', async (importActual) => {
  const actual = await importActual<typeof import('@/foundry/utils/foundry')>()
  return {
    ...actual,
    getGame: vi.fn(() => ({ messages: { get: (id: string) => messages.get(id) } })),
    getCharacter: vi.fn(() => actor)
  }
})

const { foundryApplyDamage } = await import('@/foundry/handlers/applyDamage')

// A damage roll as it sits on a posted card.
const damageRoll = () => ({
  total: 12,
  toJSON: () => ({ formula: '2d6' }),
  constructor: { fromData: (d: unknown) => ({ ...(d as object), total: 12, alter: () => ({}) }) }
})

const apply = (mode: ApplyDamageArgs['mode'] = 'damage') =>
  foundryApplyDamage({
    action: TM.APPLY_DAMAGE,
    uuid: 'req-1',
    userId: 'user-2',
    characterId: 'seelah-id',
    messageId: 'msg-1',
    mode
  } as ApplyDamageArgs)

const appliedToken = () => (applyDamage.mock.calls[0]?.[0] as { token?: FakeToken })?.token

beforeEach(() => {
  vi.clearAllMocks()
  messages.clear()
  messages.set('msg-1', { rolls: [damageRoll()] })
  ;(globalThis as Record<string, unknown>).game = { user: { _id: 'gm-1' } }
})

describe('token selection', () => {
  it('uses a linked token on the scene this client has drawn', async () => {
    actor = makeActor({ drawn: [{ id: 'tok-drawn', actorLink: true }] })
    await apply()
    expect(appliedToken()?.id).toBe('tok-drawn')
    // Never needed the cross-scene lookup.
    expect(actor.getDependentTokens).not.toHaveBeenCalled()
  })

  it('falls back to an unlinked token on the drawn scene', async () => {
    actor = makeActor({ drawn: [{ id: 'tok-unlinked', actorLink: false }] })
    await apply()
    expect(appliedToken()?.id).toBe('tok-unlinked')
  })

  // The bug this fixes. getActiveTokens reads canvas.scene, so with the GM on
  // another scene it returns nothing and the handler used to throw "no token on
  // the active scene" — a failure caused entirely by where the GM was looking.
  it('finds a token on another scene when the GM is not viewing the party', async () => {
    actor = makeActor({ elsewhere: [{ id: 'tok-other-scene', actorLink: true }] })
    await apply()
    expect(appliedToken()?.id).toBe('tok-other-scene')
  })

  // Same case with no canvas at all: core's getActiveTokens returns [] when
  // canvas.ready is false, e.g. a GM sitting on the world setup screen.
  it('works with no canvas up at all', async () => {
    actor = makeActor({ elsewhere: [{ id: 'tok-somewhere', actorLink: true }] })
    actor.getActiveTokens = vi.fn(() => [])
    await apply()
    expect(appliedToken()?.id).toBe('tok-somewhere')
  })

  it('prefers a linked token over an unlinked one across scenes', async () => {
    actor = makeActor({
      elsewhere: [
        { id: 'tok-unlinked', actorLink: false },
        { id: 'tok-linked', actorLink: true }
      ]
    })
    await apply()
    expect(appliedToken()?.id).toBe('tok-linked')
  })

  it('takes an unlinked token when that is all there is', async () => {
    actor = makeActor({ elsewhere: [{ id: 'tok-only', actorLink: false }] })
    await apply()
    expect(appliedToken()?.id).toBe('tok-only')
  })

  // Still a real failure — PF2e requires a token — but now it means what it says.
  it('refuses when the actor has no token anywhere', async () => {
    actor = makeActor()
    await expect(apply()).rejects.toThrow('Seelah has no token on any scene')
    expect(applyDamage).not.toHaveBeenCalled()
  })
})

describe('preconditions', () => {
  it('refuses an unknown message', async () => {
    actor = makeActor({ drawn: [{ id: 'tok', actorLink: true }] })
    messages.clear()
    await expect(apply()).rejects.toThrow('Chat message msg-1 not found')
  })

  it('refuses a message with no damage roll at the index', async () => {
    actor = makeActor({ drawn: [{ id: 'tok', actorLink: true }] })
    messages.set('msg-1', { rolls: [] })
    await expect(apply()).rejects.toThrow('No damage roll at index 0')
  })
})

describe('modes', () => {
  beforeEach(() => {
    actor = makeActor({ drawn: [{ id: 'tok', actorLink: true }] })
  })

  it('passes the roll through so PF2e can apply per-type IWR', async () => {
    await apply('damage')
    const call = applyDamage.mock.calls[0][0] as { damage: { total: number } }
    expect(call.damage.total).toBe(12)
  })

  it('requests a shield block', async () => {
    await apply('block')
    const call = applyDamage.mock.calls[0][0] as { shieldBlockRequest?: boolean }
    expect(call.shieldBlockRequest).toBe(true)
  })

  // PF2e reads negative scalar damage as healing.
  it('heals with a negative scalar', async () => {
    await apply('heal')
    const call = applyDamage.mock.calls[0][0] as { damage: number }
    expect(call.damage).toBe(-12)
  })
})
