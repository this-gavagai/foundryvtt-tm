import type { DifferentialReport } from './differential'
import { predictionMisses, type PredictionMiss } from '@/utils/derivedReconcile'
import type { Figure } from '@/utils/derivedFigures'
import { describeDifferential } from './differential'
import { logger } from '@/utils/utilities'

// The harness's console surface.
//
// It announces itself once, counts every report whether clean or not, and keeps
// them where they can be interrogated rather than scrolled back to — because an
// instrument that is silent when healthy cannot distinguish "no problem" from
// "no measurement", which is the confusion the engine's ledger exists to prevent
// everywhere else.

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
  // Payloads NOT measured with the engine configured as the sheet configures it.
  //
  // Aggregated here rather than left on each report, because a flag nobody sums
  // is a flag nobody reads — which is how the omission it records survived. A
  // run with `misconfigured > 0` is not a weaker measurement of the engine; it
  // is a measurement of a different one, whose skip counts and modifier sets do
  // not describe what any player sees.
  misconfigured: number
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
  let misconfigured = 0

  for (const report of reports) {
    if (report.clean) clean++
    // The sheet always passes a trait vocabulary once the catalog is published,
    // so a report without one classified every bare trait atom more
    // pessimistically than production does.
    if (!report.usedTraitVocabulary || !report.usedSource) misconfigured++
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
    misconfigured,
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
      // otherwise. A different question from the differential above, which
      // compares the engine against the payload it arrived with — both
      // describing one settled world. See utils/derivedReconcile.
      predictions: () => PredictionMiss[]
      // Every derivable figure with our answer beside the payload's, right now.
      //
      // The third question, needing neither a write nor a divergence: in a world
      // nobody has touched, does each figure AGREE with the payload it will be
      // compared against? A figure whose two sides render the same world in
      // different SHAPES reports a miss on every payload with the numbers
      // identical, which is invisible from the other two inspectors.
      figures: () => FigureReading[]
      reset: () => void
    }
  }
}

export interface FigureReading {
  actorId: string
  key: string
  ours: unknown
  payload: unknown
  agrees: boolean
}

// The sheet owns the actor, so it lends its table rather than this reaching for
// one — and KEYED BY ACTOR, because more than one sheet is mounted at a time. A
// single slot read whichever sheet mounted last while reporting numbers as
// though they were the one on screen: an instrument answering a question next to
// the one being asked, which is the same mistake this inspector exists to find.
const figureTables = new Map<string, () => Figure[]>()

export function registerFigures(actorId: string, table: (() => Figure[]) | undefined): void {
  if (table) figureTables.set(actorId, table)
  else figureTables.delete(actorId)
}

function readFigures(): FigureReading[] {
  const out: FigureReading[] = []
  for (const [actorId, table] of figureTables) {
    for (const figure of table()) {
      const ours = figure.value()
      const payload = figure.reported()
      out.push({
        actorId,
        key: figure.key,
        ours,
        payload,
        // A figure the payload says nothing about is not a disagreement.
        agrees: payload === undefined || payload === null || Object.is(ours, payload)
      })
    }
  }
  return out
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
    figures: readFigures,
    reset: () => {
      reports.length = 0
    }
  }
  logger.warn(
    'TM: rule engine harness armed — inspect with window.__tmRuleEngine.summary(), ' +
      'window.__tmRuleEngine.predictions() for figures a write predicted wrongly, ' +
      'and window.__tmRuleEngine.figures() for what each says at rest. ' +
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
