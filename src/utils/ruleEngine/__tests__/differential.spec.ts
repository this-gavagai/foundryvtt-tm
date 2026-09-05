import { describe, it, expect } from 'vitest'
import { runDifferential, describeDifferential } from '@/utils/ruleEngine/differential'
import { labelPayload } from '@/utils/__tests__/fixtures/labelPayload'
import type { UpdateCharacterDetailsArgs } from '@/types/api-types'

const STAMP = 'pf2e@8.4.1|en|1.4.0'

// Cast at the fixture boundary, once — the sibling character specs make the same
// one. `actor` on the wire is serialized source data; the type claims a live
// PF2e document, which nothing here is or needs to be.
const asActor = (items: unknown[]) =>
  ({ items }) as unknown as UpdateCharacterDetailsArgs['actor']

// The harness exists to catch the engine being wrong on real characters. These
// check it can actually tell the three kinds of wrong apart — a harness that
// reports "clean" regardless would be worse than none.

function payload(
  items: unknown[],
  acModifiers: unknown[],
  activeRules: string[] = []
): UpdateCharacterDetailsArgs {
  return labelPayload({
    actorId: 'seelah',
    actor: asActor(items),
    system: {
      details: { level: { value: 5 } },
      traits: { value: ['human'] },
      attributes: { ac: { modifiers: acModifiers } }
    } as unknown as UpdateCharacterDetailsArgs['system'],
    activeRules
  })
}

const ringItem = (value: number, extra: Record<string, unknown> = {}) => ({
  name: 'Ring',
  type: 'equipment',
  system: {
    slug: 'ring',
    rules: [{ key: 'FlatModifier', selector: 'ac', type: 'item', slug: 'ring', value, ...extra }]
  }
})

describe('agreement', () => {
  it('reports clean when the engine matches PF2e', () => {
    const report = runDifferential(
      payload([ringItem(1)], [{ slug: 'ring', modifier: 1, enabled: true }]),
      STAMP
    )
    expect(report.clean).toBe(true)
    expect(describeDifferential(report)).toContain('clean')
  })

  it('ignores modifiers no FlatModifier on the actor could have produced', () => {
    // PF2e reports base and proficiency modifiers in the same list. The engine
    // is not supposed to produce those, so counting them would drown the signal.
    const report = runDifferential(
      payload([], [{ slug: 'proficiency', modifier: 9, enabled: true }]),
      STAMP
    )
    expect(report.clean).toBe(true)
  })

  it('ignores a modifier PF2e reports as disabled', () => {
    const report = runDifferential(payload([], [{ slug: 'ring', modifier: 1, enabled: false }]), STAMP)
    expect(report.clean).toBe(true)
  })
})

describe('divergence', () => {
  it('catches a value mismatch', () => {
    const report = runDifferential(
      payload([ringItem(2)], [{ slug: 'ring', modifier: 1, enabled: true }]),
      STAMP
    )
    const ac = report.figures.find((f) => f.figure === 'ac')!
    expect(ac.valueMismatch).toEqual([{ slug: 'ring', engine: 2, pf2e: 1 }])
    expect(describeDifferential(report)).toContain('2≠1')
  })

  it('catches over-application — the engine said yes where PF2e said no', () => {
    // The engine resolved a predicate as true that PF2e resolved as false, so it
    // produced a modifier the system did not. This inflates a defence.
    const report = runDifferential(payload([ringItem(1)], []), STAMP)
    const ac = report.figures.find((f) => f.figure === 'ac')!
    expect(ac.engineOnly).toEqual(['ring'])
    expect(describeDifferential(report)).toContain('over-applied')
  })

  it('catches a SILENT MISS and says so loudly', () => {
    // The dangerous one: PF2e has a modifier from a FlatModifier on this actor,
    // the engine produced neither the modifier nor a skip. The ledger was
    // supposed to make that impossible, so it indicts the honesty machinery
    // rather than the arithmetic.
    //
    // Provoked here by an unreachable formula whose skip is recorded against the
    // item rather than the slug — exactly the attribution gap worth catching.
    const items = [
      {
        name: 'Ring',
        type: 'equipment',
        system: {
          slug: 'ring',
          rules: [
            {
              key: 'FlatModifier',
              selector: 'ac',
              type: 'item',
              slug: 'mystery',
              value: '@actor.abilities.str.mod'
            }
          ]
        }
      }
    ]
    const report = runDifferential(
      payload(items, [{ slug: 'mystery', modifier: 3, enabled: true }]),
      STAMP
    )
    const ac = report.figures.find((f) => f.figure === 'ac')!
    // The skip was recorded, so this is NOT silent — the ledger did its job.
    expect(ac.skipped).toBe(1)
    expect(ac.silentMiss).toEqual([])
  })

  it('does count a miss the ledger failed to record', () => {
    // A FlatModifier whose predicate resolves cleanly to false against our
    // option set, but which PF2e applied — meaning our option set was wrong, and
    // nothing was skipped to warn us.
    const items = [
      {
        name: 'Ring',
        type: 'equipment',
        system: {
          slug: 'ring',
          rules: [
            {
              key: 'FlatModifier',
              selector: 'ac',
              type: 'item',
              slug: 'ring',
              value: 1,
              predicate: ['self:trait:elf']
            }
          ]
        }
      }
    ]
    const report = runDifferential(
      payload(items, [{ slug: 'ring', modifier: 1, enabled: true }]),
      STAMP
    )
    const ac = report.figures.find((f) => f.figure === 'ac')!
    expect(ac.silentMiss).toEqual(['ring'])
    expect(report.silentMisses).toBe(1)
    expect(describeDifferential(report)).toContain('SILENT MISS')
  })
})

describe('coverage', () => {
  it('compares every statistic the payload reports modifiers for', () => {
    const args = labelPayload({
      actorId: 'seelah',
      actor: asActor([]),
      system: {
        details: { level: { value: 5 } },
        attributes: { ac: { modifiers: [] } },
        perception: { modifiers: [] },
        saves: { fortitude: { modifiers: [] }, reflex: { modifiers: [] } },
        skills: { athletics: { modifiers: [], attribute: 'str' } }
      } as unknown as UpdateCharacterDetailsArgs['system']
    })
    const report = runDifferential(args, STAMP)
    expect(report.figures.map((f) => f.figure).sort()).toEqual([
      'ac',
      'athletics',
      'fortitude',
      'perception',
      'reflex'
    ])
  })
})
