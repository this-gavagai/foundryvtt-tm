import { describe, it, expect } from 'vitest'
import { runDifferential, describeDifferential } from '@/utils/ruleEngine/differential'
import { labelPayload } from '@/utils/__tests__/fixtures/labelPayload'
import type { UpdateCharacterDetailsArgs } from '@/types/api-types'

const STAMP = 'pf2e@8.4.1|en|1.4.0'

// Cast at the fixture boundary, once — the sibling character specs make the same
// one. `actor` on the wire is serialized source data; the type claims a live
// PF2e document, which nothing here is or needs to be.
const asActor = (items: unknown[]) => ({ items }) as unknown as UpdateCharacterDetailsArgs['actor']

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
    const report = runDifferential(
      payload([], [{ slug: 'ring', modifier: 1, enabled: false }]),
      STAMP
    )
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
    // hp-max and initiative join the list unconditionally: neither has a
    // modifier list to key off, so both are compared whenever the payload
    // reports a level.
    expect(report.figures.map((f) => f.figure).sort()).toEqual([
      'ac',
      'athletics',
      'fortitude',
      'hp-max',
      'initiative',
      'perception',
      'reflex'
    ])
  })

  // Spellcasting entries are keyed by item id in a sibling field, not by a
  // `system` sub-object like every other statistic — so this row is the one
  // most likely to silently compare nothing at all.
  it('compares each spellcasting entry’s DC and attack separately', () => {
    const entry = (id: string, name: string, ability: string) => ({
      _id: id,
      name,
      type: 'spellcastingEntry',
      system: {
        slug: name.toLowerCase(),
        rules: [],
        ability: { value: ability },
        tradition: { value: 'arcane' },
        proficiency: { value: 1 }
      }
    })
    const args = labelPayload({
      actorId: 'ezren',
      actor: asActor([entry('a1', 'Arcane', 'int'), entry('b2', 'Bardic', 'cha')]),
      // Top level, exactly where the Foundry side puts it. Nesting this under
      // `actor` — where the sheet reads its merged copy from — is what made an
      // earlier version of this comparison silently compare nothing.
      spellcastingModifiers: {
        a1: { dc: 21, mod: 11, modifiers: [] },
        b2: { dc: 17, mod: 7, modifiers: [] }
      } as unknown as UpdateCharacterDetailsArgs['spellcastingModifiers'],
      system: {
        details: { level: { value: 5 } }
      } as unknown as UpdateCharacterDetailsArgs['system']
    })
    const figures = runDifferential(args, STAMP).figures.map((f) => f.figure)
    expect(figures).toContain('Arcane DC')
    expect(figures).toContain('Arcane attack')
    expect(figures).toContain('Bardic DC')
    expect(figures).toContain('Bardic attack')
  })
})

describe('whole totals', () => {
  // Strictly stronger than the modifier comparison: it exercises the base
  // arithmetic — proficiency ranks, class fields, dex caps, ancestry hit points
  // — which the modifier sets cannot see. A figure can have a perfect modifier
  // set and still be six points out.
  const fighter = [
    {
      name: 'Fighter',
      type: 'class',
      system: {
        slug: 'fighter',
        rules: [],
        savingThrows: { fortitude: 2, reflex: 2, will: 1 },
        defenses: { unarmored: 1, light: 1, medium: 1, heavy: 1 },
        perception: 2,
        hp: 10
      }
    },
    { name: 'Human', type: 'ancestry', system: { slug: 'human', rules: [], hp: 8 } }
  ]

  const withTotals = (system: Record<string, unknown>) =>
    labelPayload({
      actorId: 'seelah',
      actor: asActor(fighter),
      system: {
        details: { level: { value: 8 } },
        abilities: {
          str: { mod: 4 },
          dex: { mod: 2 },
          con: { mod: 3 },
          int: { mod: 0 },
          wis: { mod: 1 },
          cha: { mod: 0 }
        },
        ...system
      } as unknown as UpdateCharacterDetailsArgs['system']
    })

  it('agrees with PF2e when the derivation is right', () => {
    // Fortitude: con 3 + (expert 2 x 2 + 8) = 15
    const report = runDifferential(
      withTotals({ saves: { fortitude: { modifiers: [], totalModifier: 15 } } }),
      STAMP
    )
    expect(report.figures.find((f) => f.figure === 'fortitude')?.total).toBeUndefined()
  })

  it('catches a total that is wrong despite a matching modifier set', () => {
    // The case the modifier comparison is blind to: no rule elements involved
    // at all, and the number is still six out.
    const report = runDifferential(
      withTotals({ saves: { fortitude: { modifiers: [], totalModifier: 21 } } }),
      STAMP
    )
    const fortitude = report.figures.find((f) => f.figure === 'fortitude')!
    expect(fortitude.valueMismatch).toEqual([])
    expect(fortitude.total).toEqual({ engine: 15, pf2e: 21 })
    expect(report.totalMismatches).toBe(1)
    expect(describeDifferential(report)).toContain('TOTAL 15≠21')
  })

  it('compares maximum hit points, which have no modifier list at all', () => {
    // 8 + (10 + 3) x 8 = 112
    const good = runDifferential(withTotals({ attributes: { hp: { max: 112 } } }), STAMP)
    expect(good.figures.find((f) => f.figure === 'hp-max')?.total).toBeUndefined()
    const bad = runDifferential(withTotals({ attributes: { hp: { max: 130 } } }), STAMP)
    expect(bad.figures.find((f) => f.figure === 'hp-max')?.total).toEqual({
      engine: 112,
      pf2e: 130
    })
  })

  it('checks calcAttribute on its own line', () => {
    // One wrong attribute would otherwise surface as a dozen wrong figures and
    // read as a dozen bugs.
    const report = runDifferential(withTotals({}), STAMP)
    // The fixture has no build data, so calcAttribute returns 0 against PF2e's
    // reported modifiers — exactly the divergence this line exists to name.
    expect(report.attributes.map((a) => a.attribute)).toContain('str')
    expect(describeDifferential(report)).toContain('ATTRIBUTES')
  })
})
