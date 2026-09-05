import { describe, it, expect } from 'vitest'
import { deriveFigure, saveDomains, AC_DOMAINS, describeLedger } from '@/utils/ruleEngine'
import { applyStacking, type EngineModifier } from '@/utils/ruleEngine/flatModifiers'

const STAMP = 'pf2e@8.4.1|en|1.4.0'

const item = (name: string, rules: unknown[], extra: Record<string, unknown> = {}) => ({
  name,
  type: 'equipment',
  system: { slug: name.toLowerCase(), rules, ...extra }
})

const input = (items: ReturnType<typeof item>[], stamp: string | undefined = STAMP) => ({
  items,
  options: { level: 5, traits: ['human'], items },
  paths: { 'actor.level': 5 },
  stamp
})

describe('collecting modifiers', () => {
  it('applies a FlatModifier that reaches the domain', () => {
    const result = deriveFigure(
      input([
        item('Ring of Protection', [
          { key: 'FlatModifier', selector: 'ac', type: 'item', value: 1 }
        ])
      ]),
      AC_DOMAINS
    )
    expect(result.total).toBe(1)
    expect(result.ledger.confidence).toBe('exact')
  })

  it('ignores a modifier aimed at some other statistic', () => {
    const result = deriveFigure(
      input([item('Cloak', [{ key: 'FlatModifier', selector: 'reflex', value: 2 }])]),
      AC_DOMAINS
    )
    expect(result.total).toBe(0)
    expect(result.ledger.confidence).toBe('exact')
  })

  it('matches on any of the statistic’s domains, not just its slug', () => {
    // `saving-throw` and `all` both reach a save; a selector list that only
    // checked the slug would drop most of the modifiers in the compendium.
    const result = deriveFigure(
      input([
        item('Resilient', [{ key: 'FlatModifier', selector: 'saving-throw', type: 'item', value: 1 }]),
        item('Blessing', [{ key: 'FlatModifier', selector: 'all', type: 'status', value: 1 }])
      ]),
      saveDomains('fortitude')
    )
    expect(result.total).toBe(2)
  })

  it('resolves a formula against source-derivable paths', () => {
    const result = deriveFigure(
      input([
        item('Scaling', [
          { key: 'FlatModifier', selector: 'ac', type: 'untyped', value: 'floor(@actor.level / 2)' }
        ])
      ]),
      AC_DOMAINS
    )
    expect(result.total).toBe(2)
  })
})

describe('the ledger', () => {
  it('counts a rule element type it does not implement', () => {
    const result = deriveFigure(
      input([item('Bracers', [{ key: 'AdjustModifier', selector: 'ac', value: 1 }])]),
      AC_DOMAINS
    )
    expect(result.total).toBe(0)
    expect(result.ledger.confidence).toBe('provisional')
    expect(result.ledger.skipped[0]).toMatchObject({ reason: 'unsupported-key', key: 'AdjustModifier' })
  })

  it('counts a predicate it cannot resolve, and applies nothing for it', () => {
    // The important case: the modifier might apply. Guessing either way produces
    // a plausible number, so the engine produces a number AND a warning instead.
    const result = deriveFigure(
      input([
        item('Shield Block', [
          { key: 'FlatModifier', selector: 'ac', type: 'circumstance', value: 2, predicate: ['self:armored'] }
        ])
      ]),
      AC_DOMAINS
    )
    expect(result.total).toBe(0)
    expect(result.ledger.skipped[0].reason).toBe('unresolvable-predicate')
  })

  it('counts an unreachable formula', () => {
    const result = deriveFigure(
      input([
        item('Str Bonus', [
          { key: 'FlatModifier', selector: 'ac', value: '@actor.abilities.str.mod' }
        ])
      ]),
      AC_DOMAINS
    )
    expect(result.ledger.skipped[0].reason).toBe('unresolvable-value')
  })

  it('drops a modifier whose predicate is definitively false, without a skip', () => {
    // A false predicate is an answer, not a gap: the figure stays exact.
    const result = deriveFigure(
      input([
        item('Elf Only', [
          { key: 'FlatModifier', selector: 'ac', value: 1, predicate: ['self:trait:elf'] }
        ])
      ]),
      AC_DOMAINS
    )
    expect(result.total).toBe(0)
    expect(result.ledger.confidence).toBe('exact')
  })

  it('refuses to confirm an investment requirement source cannot answer', () => {
    const result = deriveFigure(
      input([
        item(
          'Uninvestable',
          [{ key: 'FlatModifier', selector: 'ac', value: 1, requiresInvestment: true }],
          { equipped: { carryType: 'worn' } }
        )
      ]),
      AC_DOMAINS
    )
    expect(result.ledger.skipped[0].reason).toBe('unconfirmable-requirement')
  })

  it('does not report unrelated rules as gaps in this figure', () => {
    // The ledger measures THIS statistic. An unimplemented rule aimed elsewhere
    // is not a reason to doubt the number in front of the player.
    const result = deriveFigure(
      input([item('Speedy', [{ key: 'BaseSpeed', selector: 'land', value: 10 }])]),
      AC_DOMAINS
    )
    expect(result.ledger.confidence).toBe('exact')
  })

  it('says how many were missed, not just that some were', () => {
    const result = deriveFigure(
      input([
        item('A', [{ key: 'AdjustModifier', selector: 'ac', value: 1 }]),
        item('B', [{ key: 'FlatModifier', selector: 'ac', value: 1, predicate: ['self:armored'] }])
      ]),
      AC_DOMAINS
    )
    expect(describeLedger(result.ledger)).toContain('2 not evaluated')
  })
})

describe('the version gate', () => {
  it('marks everything unverified on a system version it was not checked against', () => {
    // Nothing here LOOKS wrong, which is the point: a rule element whose
    // behaviour moved under the engine is invisible from inside it.
    const result = deriveFigure(
      input([item('Ring', [{ key: 'FlatModifier', selector: 'ac', type: 'item', value: 1 }])], 'pf2e@9.0.0|en|1.4.0'),
      AC_DOMAINS
    )
    expect(result.total).toBe(1)
    expect(result.ledger.confidence).toBe('unverified')
  })

  it('outranks a clean ledger', () => {
    // A module too old to announce a stamp cannot vouch for its system version
    // either, so an empty ledger is not enough to claim exactness.
    const result = deriveFigure(
      { items: [], options: {}, paths: {}, stamp: undefined },
      AC_DOMAINS
    )
    expect(result.ledger.skipped).toHaveLength(0)
    expect(result.ledger.confidence).toBe('unverified')
  })

  it('tolerates a patch release', () => {
    const result = deriveFigure(input([], 'pf2e@8.4.7|de|2.0.0'), AC_DOMAINS)
    expect(result.ledger.confidence).toBe('exact')
  })
})

describe('stacking', () => {
  const mod = (over: Partial<EngineModifier>): EngineModifier => ({
    slug: 's',
    label: 'l',
    modifier: 0,
    type: 'untyped',
    enabled: true,
    hideIfDisabled: false,
    force: false,
    source: '',
    ...over
  })

  it('keeps only the best of a type, and the worst penalty', () => {
    expect(
      applyStacking([
        mod({ type: 'item', modifier: 1 }),
        mod({ type: 'item', modifier: 2 }),
        mod({ type: 'item', modifier: -1 })
      ])
    ).toBe(1)
  })

  it('lets untyped modifiers all through', () => {
    expect(applyStacking([mod({ modifier: 1 }), mod({ modifier: 2 })])).toBe(3)
  })

  it('exempts a forced modifier from the contest', () => {
    expect(
      applyStacking([
        mod({ type: 'status', modifier: 2 }),
        mod({ type: 'status', modifier: 1, force: true })
      ])
    ).toBe(3)
  })
})
