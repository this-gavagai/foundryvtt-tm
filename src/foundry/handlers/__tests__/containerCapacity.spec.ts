import { describe, it, expect } from 'vitest'
import type { ActorPF2e } from '@7h3laughingman/pf2e-types'
import { serializeContainers } from '@/foundry/handlers/characterDetails'

// The container readout is derived Foundry-side because none of it survives as
// source data: how full a container is depends on what PF2e has stowed in it
// this preparation cycle, and how much Bulk it negates depends on whether that
// negation currently applies at all.
//
// The doubles below are not sketches of ContainerPF2e — they carry the real
// class's arithmetic verbatim (pf2e 8.4.1: Bulk, Container#capacity,
// #percentFull, #bulkIgnored), because a readout that quietly disagrees with
// the sheet is worse than no readout, and paraphrased bulk math is exactly how
// that happens. `contents` here is the total Bulk PF2e's computeTotalBulk
// would return for what the container holds, which is the one thing the double
// is allowed to state outright rather than derive.

/** pf2e's Bulk: tenths, clamped at zero and rounded to one decimal. */
class Bulk {
  readonly value: number
  constructor(value = 0) {
    this.value = Math.round(Math.max(value, 0) * 10) / 10
  }
  get normal() {
    return Math.floor(this.value)
  }
  get light() {
    return Math.round((this.value - this.normal) * 10)
  }
  toLightUnits() {
    return this.normal * 10 + this.light
  }
}

type ContainerOpts = {
  id: string
  /** Bulk of what is stowed inside, as computeTotalBulk would total it. */
  contents?: number
  /** The capacity typed on the item (system.bulk.capacity). */
  capacity?: number
  /** The Bulk it negates when nothing has suspended it (system.bulk.ignored). */
  ignored?: number
  /** An extradimensional container inside another one negates nothing. */
  nestedExtradimensional?: boolean
}

function makeContainer(opts: ContainerOpts) {
  const { id, contents = 0, capacity = 0, ignored = 0, nestedExtradimensional = false } = opts
  return {
    id,
    type: 'backpack',
    isOfType: (...types: string[]) => types.includes('backpack'),
    system: { bulk: { value: 1, capacity, ignored } },
    get capacity() {
      return { value: new Bulk(contents), max: new Bulk(capacity) }
    },
    get percentFull() {
      const { value, max } = this.capacity
      const percent = Math.floor((value.toLightUnits() / max.toLightUnits()) * 100)
      return percent > 100 ? Math.floor((value.normal / max.normal) * 100) : percent
    },
    get bulkIgnored() {
      const overCapacity = this.percentFull > 100
      return !overCapacity && !nestedExtradimensional ? new Bulk(ignored) : new Bulk()
    }
  }
}

function makeActor(items: unknown[]): ActorPF2e {
  return { items } as unknown as ActorPF2e
}

describe('serializeContainers', () => {
  it('reads a half-full backpack off PF2e’s own getters', () => {
    const actor = makeActor([makeContainer({ id: 'pack', contents: 4, capacity: 8, ignored: 2 })])

    expect(serializeContainers(actor)).toEqual({
      pack: { value: 4, max: 8, percentFull: 50, ignored: 2, ignoredMax: 2 }
    })
  })

  it('keeps light Bulk, which is all a nearly-empty container holds', () => {
    // Six light items: 0.6 Bulk, and 7% of a backpack — the value the app
    // splits back into "6L" rather than rounding away to 0.
    const actor = makeActor([makeContainer({ id: 'pack', contents: 0.6, capacity: 8, ignored: 2 })])

    expect(serializeContainers(actor).pack).toMatchObject({ value: 0.6, percentFull: 7 })
  })

  it('reports the negation as lapsed once the container is over capacity', () => {
    const actor = makeActor([makeContainer({ id: 'pack', contents: 9, capacity: 8, ignored: 2 })])

    // ignoredMax still says what the item claims; ignored says what PF2e is
    // applying, which is nothing — that gap is the whole point of sending both.
    expect(serializeContainers(actor).pack).toEqual({
      value: 9,
      max: 8,
      percentFull: 112,
      ignored: 0,
      ignoredMax: 2
    })
  })

  it('reports a nested extradimensional bag as negating nothing, though it fits', () => {
    const actor = makeActor([
      makeContainer({
        id: 'bag',
        contents: 2,
        capacity: 8,
        ignored: 6,
        nestedExtradimensional: true
      })
    ])

    expect(serializeContainers(actor).bag).toMatchObject({
      percentFull: 25,
      ignored: 0,
      ignoredMax: 6
    })
  })

  it('gives a non-stowing container a zero capacity, which the app reads as "no readout"', () => {
    // PF2e zeroes capacity and negation on anything that doesn't stow (a
    // sheath, a bandolier) and counts its contents against the wearer directly.
    const actor = makeActor([makeContainer({ id: 'sheath', contents: 0, capacity: 0 })])

    expect(serializeContainers(actor).sheath).toMatchObject({ max: 0, ignored: 0 })
  })

  it('skips non-containers', () => {
    const sword = {
      id: 'sword',
      type: 'weapon',
      isOfType: (...t: string[]) => t.includes('weapon')
    }
    const actor = makeActor([sword, makeContainer({ id: 'pack', capacity: 8 })])

    expect(Object.keys(serializeContainers(actor))).toEqual(['pack'])
  })

  it('drops a container whose capacity getter has gone missing rather than the payload', () => {
    // The getters are prepared members of a system class the module doesn't
    // pin: a rename should cost this one readout, not every character detail
    // serialized after it.
    const drifted = {
      id: 'drifted',
      type: 'backpack',
      isOfType: (...t: string[]) => t.includes('backpack'),
      system: { bulk: { capacity: 8, ignored: 2 } }
    }
    const actor = makeActor([drifted, makeContainer({ id: 'pack', contents: 1, capacity: 8 })])

    expect(serializeContainers(actor)).toEqual({
      pack: { value: 1, max: 8, percentFull: 12, ignored: 0, ignoredMax: 0 }
    })
  })
})
