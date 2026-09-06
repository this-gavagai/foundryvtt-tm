import type { DifferentialReport } from './differential'
import { predictionMisses, type PredictionMiss } from '@/utils/derivedReconcile'
import { describeDifferential } from './differential'
import { logger } from '@/utils/utilities'

// The harness's console surface, and its answer to a question the first version
// could not answer: "is this thing running?"
//
// That version logged only when a report diverged, which made silence ambiguous
// in exactly the way the whole engine design exists to avoid. Seeing nothing was
// consistent with everything matching, with Chrome hiding `console.debug`, with
// a production build, with `runDifferential` throwing on every payload, and with
// no payloads arriving at all. An instrument that is silent when healthy cannot
// distinguish "no problem" from "no measurement".
//
// So: it announces itself once, counts every report whether clean or not, and
// keeps them where they can be interrogated rather than scrolled back to.

export interface HarnessSummary {
  payloads: number
  clean: number
  diverged: number
  silentMisses: number
  totalMismatches: number
  // Total comparisons that actually happened, against those that could not.
  //
  // `totalMismatches: 0` alone is not evidence of correctness — a figure PF2e
  // never reports produces no mismatch forever. Reading these two together is
  // what separates "the engine agrees" from "nothing was checked".
  totalsCompared: number
  totalsUncompared: number
  // Which figures diverge most, worst first — where to look.
  byFigure: { figure: string; diverged: number; totalMismatch: number }[]
  // Which rule element types are costing the most coverage, worst first. This is
  // the number that says what to implement next, as opposed to guessing.
  bySkippedKey: { key: string; count: number }[]
  attributes: Record<string, number>
}

const reports: DifferentialReport[] = []
const MAX_RETAINED = 200

function summarize(): HarnessSummary {
  const byFigure = new Map<string, { diverged: number; totalMismatch: number }>()
  const bySkippedKey = new Map<string, number>()
  const attributes: Record<string, number> = {}
  let clean = 0
  let silentMisses = 0
  let totalMismatches = 0
  let totalsCompared = 0
  let totalsUncompared = 0

  for (const report of reports) {
    if (report.clean) clean++
    silentMisses += report.silentMisses
    totalMismatches += report.totalMismatches
    for (const attribute of report.attributes) {
      attributes[attribute.attribute] = (attributes[attribute.attribute] ?? 0) + 1
    }
    for (const figure of report.figures) {
      if (figure.totalCompared) totalsCompared++
      else totalsUncompared++
      for (const skip of figure.skippedBy) {
        const label = `${skip.key} (${skip.reason})`
        bySkippedKey.set(label, (bySkippedKey.get(label) ?? 0) + 1)
      }
      const diverges =
        figure.valueMismatch.length > 0 ||
        figure.engineOnly.length > 0 ||
        figure.silentMiss.length > 0 ||
        !!figure.total
      if (!diverges) continue
      const entry = byFigure.get(figure.figure) ?? { diverged: 0, totalMismatch: 0 }
      entry.diverged++
      if (figure.total) entry.totalMismatch++
      byFigure.set(figure.figure, entry)
    }
  }

  return {
    payloads: reports.length,
    clean,
    diverged: reports.length - clean,
    silentMisses,
    totalMismatches,
    totalsCompared,
    totalsUncompared,
    byFigure: [...byFigure.entries()]
      .map(([figure, counts]) => ({ figure, ...counts }))
      .sort((a, b) => b.diverged - a.diverged),
    bySkippedKey: [...bySkippedKey.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count),
    attributes
  }
}

declare global {
  interface Window {
    __tmRuleEngine?: {
      summary: () => HarnessSummary
      reports: () => DifferentialReport[]
      last: () => DifferentialReport | undefined
      // What we said PF2e WOULD compute after a write, where it then said
      // otherwise. A different question from the differential above — that one
      // compares the engine against the payload it arrived with, both
      // describing the same settled world; these are predictions made across a
      // mutation. See utils/derivedReconcile.
      predictions: () => PredictionMiss[]
      reset: () => void
    }
  }
}

let armed = false

// Announce once, so the console says the harness exists before any payload
// arrives. Without this the only evidence it is wired at all is a divergence,
// which is precisely the thing that may never happen.
export function armHarness(): void {
  if (armed) return
  armed = true
  // Guarded rather than assumed: the recording and the log lines are the part
  // that matters, and neither should be lost because there is no `window` to
  // hang an inspector on.
  if (typeof window === 'undefined') return
  window.__tmRuleEngine = {
    summary: summarize,
    reports: () => [...reports],
    last: () => reports[reports.length - 1],
    predictions: predictionMisses,
    reset: () => {
      reports.length = 0
    }
  }
  logger.warn(
    'TM: rule engine harness armed — inspect with window.__tmRuleEngine.summary(), ' +
      'and window.__tmRuleEngine.predictions() for figures a write predicted wrongly. ' +
      'Both need a GM online to have anything to compare against.'
  )
}

export function recordReport(report: DifferentialReport): void {
  reports.push(report)
  if (reports.length > MAX_RETAINED) reports.shift()

  // Levels chosen so the DEFAULT console shows what matters. `debug` is hidden
  // unless Chrome's Verbose filter is on, which is why only the genuinely quiet
  // case uses it.
  if (report.silentMisses > 0) {
    logger.error(describeDifferential(report))
  } else if (!report.clean) {
    logger.warn(describeDifferential(report))
  } else {
    logger.debug(describeDifferential(report))
  }
}

// A failure to RUN is not a clean result, and must not read like one.
export function recordFailure(actorId: string, error: unknown): void {
  logger.error(`TM: rule engine harness threw on ${actorId}`, error)
}
