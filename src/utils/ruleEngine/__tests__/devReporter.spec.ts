// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { armHarness, recordReport, recordFailure } from '@/utils/ruleEngine/devReporter'
import type { DifferentialReport } from '@/utils/ruleEngine/differential'

// The harness has to be able to say "I ran and found nothing", which is a
// different statement from saying nothing. These pin that distinction, because
// the first version could not make it and a clean run was indistinguishable from
// a broken one.

function report(over: Partial<DifferentialReport> = {}): DifferentialReport {
  return {
    actorId: 'seelah',
    figures: [],
    attributes: [],
    clean: true,
    silentMisses: 0,
    totalMismatches: 0,
    ...over
  }
}

const figure = (over: Partial<DifferentialReport['figures'][number]> = {}) => ({
  figure: 'ac',
  valueMismatch: [],
  engineOnly: [],
  silentMiss: [],
  skipped: 0,
  skippedBy: [],
  ...over
})

beforeEach(() => {
  armHarness()
  window.__tmRuleEngine?.reset()
  vi.restoreAllMocks()
})

describe('proof that it ran', () => {
  it('counts a clean payload rather than staying silent about it', () => {
    // The whole point: "0 payloads" and "3 payloads, all clean" must not look
    // the same to someone checking whether the harness works.
    recordReport(report())
    recordReport(report())
    const summary = window.__tmRuleEngine!.summary()
    expect(summary.payloads).toBe(2)
    expect(summary.clean).toBe(2)
    expect(summary.diverged).toBe(0)
  })

  it('exposes the last report for inspection', () => {
    recordReport(report({ actorId: 'ezren' }))
    expect(window.__tmRuleEngine!.last()?.actorId).toBe('ezren')
  })
})

describe('what the summary is for', () => {
  it('ranks the figures that diverge most', () => {
    recordReport(
      report({ clean: false, figures: [figure({ figure: 'ac', total: { engine: 20, pf2e: 22 } })] })
    )
    recordReport(
      report({ clean: false, figures: [figure({ figure: 'ac', engineOnly: ['ring'] })] })
    )
    recordReport(
      report({ clean: false, figures: [figure({ figure: 'will', engineOnly: ['x'] })] })
    )
    const { byFigure } = window.__tmRuleEngine!.summary()
    expect(byFigure[0]).toEqual({ figure: 'ac', diverged: 2, totalMismatch: 1 })
    expect(byFigure[1].figure).toBe('will')
  })

  it('ranks the rule element types costing the most coverage', () => {
    // This is the number that says what to implement next, as opposed to
    // guessing which of the remaining thirty-eight types matters.
    recordReport(
      report({
        figures: [
          figure({
            skippedBy: [
              { key: 'AdjustModifier', reason: 'unsupported-key' },
              { key: 'AdjustModifier', reason: 'unsupported-key' },
              { key: 'DamageDice', reason: 'unsupported-key' }
            ]
          })
        ]
      })
    )
    const { bySkippedKey } = window.__tmRuleEngine!.summary()
    expect(bySkippedKey[0]).toEqual({ key: 'AdjustModifier (unsupported-key)', count: 2 })
  })

  it('accumulates attribute divergence, which indicts calcAttribute not the statistics', () => {
    recordReport(report({ clean: false, attributes: [{ attribute: 'str', engine: 0, pf2e: 4 }] }))
    recordReport(report({ clean: false, attributes: [{ attribute: 'str', engine: 0, pf2e: 4 }] }))
    expect(window.__tmRuleEngine!.summary().attributes.str).toBe(2)
  })
})

describe('failures are not clean results', () => {
  it('reports a throw at error level rather than swallowing it', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    recordFailure('seelah', new Error('boom'))
    expect(spy).toHaveBeenCalled()
    // And it is NOT counted as a clean payload, which would be the worst
    // possible reading of a differential that cannot run.
    expect(window.__tmRuleEngine!.summary().clean).toBe(0)
  })
})

describe('log levels', () => {
  it('puts divergence at warn, where the default console shows it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    recordReport(report({ clean: false, figures: [figure({ engineOnly: ['ring'] })] }))
    expect(warn).toHaveBeenCalled()
  })

  it('reserves error for a silent miss, which indicts the ledger itself', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    recordReport(
      report({ clean: false, silentMisses: 1, figures: [figure({ silentMiss: ['ring'] })] })
    )
    expect(error).toHaveBeenCalled()
  })
})
