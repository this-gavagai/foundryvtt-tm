import { describe, it, expect, beforeEach, vi } from 'vitest'

// backgroundRoll.js reaches two globals Foundry provides: `libWrapper`, to wrap
// Roll.prototype.evaluate, and (through the wrapper) the Roll instances PF2e
// builds. Both are stubbed here so the refcounting and the abandonment path can
// be exercised without a Foundry client.
//
// What matters about this module is that a request's chosen dice faces reach that
// request's rolls and NOTHING else. The dispatch chain normally guarantees it by
// running one handler at a time — but it gives up on a handler still running
// after 30s, and these tests cover what happens then.

type Wrapped = (this: FakeRoll, wrapped: (opts?: object) => unknown, ...args: unknown[]) => unknown

const registrations = new Map<number, { target: string; fn: Wrapped }>()
let nextRegistrationId = 1
let wrapper: Wrapped | undefined

const libWrapperStub = {
  register: vi.fn((_app: string, target: string, fn: Wrapped) => {
    // libWrapper permits one registration per target; a second would throw, which
    // is the whole reason this module installs once and refcounts.
    if (wrapper) throw new Error(`already registered: ${target}`)
    const id = nextRegistrationId++
    registrations.set(id, { target, fn })
    wrapper = fn
    return id
  }),
  unregister: vi.fn((_app: string, id: number) => {
    if (!registrations.has(id)) throw new Error(`not registered: ${id}`)
    registrations.delete(id)
    wrapper = undefined
  })
}
vi.stubGlobal('libWrapper', libWrapperStub)

const { withBackgroundRoll, abandonBackgroundRolls } = await import('@/foundry/backgroundRoll')

// One DiceTerm: `<number>d<faces>`, with the fields the wrapper reads and writes.
type FakeDie = {
  faces: number
  number: number
  results: { result: number }[]
  _evaluated?: boolean
}
type FakeRoll = { dice: FakeDie[] }

const die = (faces: number, number = 1): FakeDie => ({ faces, number, results: [] })

// Evaluate a roll the way PF2e would: through Roll.prototype.evaluate, which is
// what the wrapper intercepts. Returns the faces the dice ended up with, or null
// when no wrapper is installed (the wrapper is what applies overrides at all).
function evaluate(...dice: FakeDie[]): { faces: number[]; wrapped: boolean; opts?: object } {
  const roll: FakeRoll = { dice }
  if (!wrapper) return { faces: [], wrapped: false }
  let seenOpts: object | undefined
  wrapper.call(roll, (opts?: object) => {
    seenOpts = opts
    return roll
  })
  return {
    faces: dice.flatMap((d) => d.results.map((r) => r.result)),
    wrapped: true,
    opts: seenOpts
  }
}

const isInstalled = () => wrapper !== undefined

beforeEach(() => {
  abandonBackgroundRolls()
  libWrapperStub.register.mockClear()
  libWrapperStub.unregister.mockClear()
})

describe('withBackgroundRoll', () => {
  it('applies the requested faces to a roll made inside it', async () => {
    await withBackgroundRoll({ d20: [17] }, async () => {
      expect(evaluate(die(20)).faces).toEqual([17])
    })
  })

  it('forces allowInteractive off while preserving the caller’s own options', async () => {
    await withBackgroundRoll({ d20: [17] }, async () => {
      const roll: FakeRoll = { dice: [die(20)] }
      let seen: object | undefined
      wrapper!.call(roll, (opts?: object) => ((seen = opts), roll), { maximize: true })
      expect(seen).toEqual({ maximize: true, allowInteractive: false })
    })
  })

  it('installs the wrapper once and removes it when the last frame settles', async () => {
    expect(isInstalled()).toBe(false)
    await withBackgroundRoll({ d20: [17] }, async () => {
      expect(isInstalled()).toBe(true)
      // Nesting must not re-register — libWrapper would throw.
      await withBackgroundRoll({ d20: [3] }, async () => {
        expect(evaluate(die(20)).faces).toEqual([3])
      })
      expect(isInstalled()).toBe(true)
      expect(evaluate(die(20)).faces).toEqual([17])
    })
    expect(isInstalled()).toBe(false)
    expect(libWrapperStub.register).toHaveBeenCalledTimes(1)
  })

  it('removes its frame even when the handler throws', async () => {
    await expect(
      withBackgroundRoll({ d20: [17] }, async () => {
        throw new Error('handler blew up')
      })
    ).rejects.toThrow('handler blew up')
    expect(isInstalled()).toBe(false)
  })

  // A frame is removed by identity, not by position. When the dispatch queue
  // abandons a hung handler the next request runs alongside it, so a positional
  // pop() would discard the frame of the request executing NOW and promote the
  // hung one's faces — the exact cross-player contamination the serialized
  // dispatch chain exists to prevent.
  it('removes the right frame when handlers settle out of order', async () => {
    let releaseHung: () => void = () => {}
    const hung = withBackgroundRoll(
      { d20: [20] },
      () => new Promise<void>((r) => (releaseHung = r))
    )

    let releaseNext: () => void = () => {}
    const next = withBackgroundRoll({ d20: [5] }, () => new Promise<void>((r) => (releaseNext = r)))
    expect(evaluate(die(20)).faces).toEqual([5])

    // The hung handler settles FIRST, while the next request is still running.
    releaseHung()
    await hung

    expect(evaluate(die(20)).faces).toEqual([5])

    releaseNext()
    await next
    expect(isInstalled()).toBe(false)
  })

  describe('face consumption', () => {
    it('advances the pool per term rather than per die index', async () => {
      await withBackgroundRoll({ d20: [17], d8: [4, 6] }, async () => {
        expect(evaluate(die(20), die(8), die(8)).faces).toEqual([17, 4, 6])
      })
    })

    it('pulls a whole term’s worth of faces for 2d8', async () => {
      await withBackgroundRoll({ d8: [4, 6] }, async () => {
        expect(evaluate(die(8, 2)).faces).toEqual([4, 6])
      })
    })

    it('rolls live when the pool carries the 0 opt-out sentinel', async () => {
      await withBackgroundRoll({ d20: [0] }, async () => {
        // No results written: Foundry does the rolling.
        expect(evaluate(die(20)).faces).toEqual([])
      })
    })

    it('rolls live when the pool is too short for the term', async () => {
      await withBackgroundRoll({ d8: [4] }, async () => {
        expect(evaluate(die(8, 2)).faces).toEqual([])
      })
    })

    it('leaves dice the request said nothing about alone', async () => {
      await withBackgroundRoll({ d20: [17] }, async () => {
        expect(evaluate(die(20), die(6)).faces).toEqual([17])
      })
    })
  })
})

describe('abandonBackgroundRolls', () => {
  // Without this, a hung handler's frame stays on the stack for the rest of the
  // session. Once the queue drains it is top-of-stack again, so a player's chosen
  // faces land on every later roll on this client — the GM's own included — and
  // the stack never reaching empty pins the libWrapper in place too.
  it('stops a hung request’s faces reaching later rolls', async () => {
    let release: () => void = () => {}
    const hung = withBackgroundRoll({ d20: [20] }, () => new Promise<void>((r) => (release = r)))
    expect(evaluate(die(20)).faces).toEqual([20])

    expect(abandonBackgroundRolls()).toBe(1)

    // Wrapper gone, so nothing overrides anything — a roll made now (by the GM in
    // Foundry's own UI, say) is an ordinary interactive roll again.
    expect(isInstalled()).toBe(false)
    expect(evaluate(die(20))).toEqual({ faces: [], wrapped: false })

    release()
    await hung
  })

  it('is safe when the abandoned handler settles afterwards', async () => {
    let releaseHung: () => void = () => {}
    const hung = withBackgroundRoll(
      { d20: [20] },
      () => new Promise<void>((r) => (releaseHung = r))
    )
    abandonBackgroundRolls()

    // A fresh request arrives and installs the wrapper again.
    let releaseNext: () => void = () => {}
    const next = withBackgroundRoll({ d20: [5] }, () => new Promise<void>((r) => (releaseNext = r)))
    expect(evaluate(die(20)).faces).toEqual([5])

    // The abandoned handler finally settles. Its frame is already gone, so its
    // `finally` must not remove the live request's frame or uninstall the wrapper.
    releaseHung()
    await hung
    expect(isInstalled()).toBe(true)
    expect(evaluate(die(20)).faces).toEqual([5])

    releaseNext()
    await next
    expect(isInstalled()).toBe(false)
  })

  it('reports how many frames it dropped, and no-ops when idle', async () => {
    expect(abandonBackgroundRolls()).toBe(0)
    expect(libWrapperStub.unregister).not.toHaveBeenCalled()

    let release: () => void = () => {}
    const outer = withBackgroundRoll({ d20: [20] }, async () => {
      await withBackgroundRoll({ d20: [1] }, () => new Promise<void>((r) => (release = r)))
    })
    expect(abandonBackgroundRolls()).toBe(2)

    release()
    await outer
  })
})
