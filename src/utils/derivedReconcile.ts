import type { Ref } from 'vue'
import type { TablemateCharacter } from '@/types/character-types'
import { derivableFigures } from '@/utils/derivedFigures'
import { logger } from '@/utils/utilities'

// One rule for every derived value on the sheet:
//
//   TRUST THE PAYLOAD, until our own calculation says the world moved. Then the
//   payload's copy is stale by definition, so drop it and let the calculation
//   stand — until the next payload arrives and becomes canonical again.
//
// No taxonomy of which figures are trusted. No dependency map of what a write
// invalidates. A write that does not change a figure leaves its calculation
// where it was, so the payload's copy survives; a write that does change one
// moves the calculation, and the difference IS the invalidation signal.
//
// The snapshot is what makes that comparison possible, and it doubles as a
// PREDICTION: we have said what PF2e will report for this figure once it
// recomputes. checkPredictions cashes that in when the payload lands.

type Snapshot = Map<string, unknown>

// Per actor, so two sheets open at once do not read each other's predictions.
const snapshots = new Map<string, Snapshot>()

export interface PredictionMiss {
  key: string
  predicted: unknown
  reported: unknown
}

const misses: PredictionMiss[] = []
const MAX_RETAINED = 200

// Recompute everything, drop the payload wherever the answer moved.
//
// Called when a write fires a refresh — a user action, not a render — which is
// why computing every figure here is affordable where doing it per render would
// not be. Returns the keys whose payload copy was dropped, for the log line.
export function reconcileDerived(
  actorId: string | undefined,
  actor: Ref<TablemateCharacter | undefined>,
  stamp: string | undefined
): string[] {
  if (!actorId) return []
  const previous = snapshots.get(actorId)
  const next: Snapshot = new Map()
  const moved: string[] = []

  for (const figure of derivableFigures(actor, stamp)) {
    let value: unknown
    try {
      value = figure.value()
    } catch (error) {
      // One misbehaving derivation must not stop the rest from reconciling.
      logger.debug('reconcile: derivation threw', figure.key, error)
      continue
    }
    next.set(figure.key, value)
    // First time through there is nothing to compare against, so nothing is
    // dropped: the payload is the best answer until we have seen the world
    // change at least once.
    if (!previous || !previous.has(figure.key)) continue
    if (Object.is(previous.get(figure.key), value)) continue
    moved.push(figure.key)
    figure.clear()
  }

  snapshots.set(actorId, next)
  if (moved.length) logger.debug('reconcile: payload dropped for', moved.join(', '))
  return moved
}

// The other half. A payload has landed; compare what PF2e now says against what
// we predicted it would say.
//
// This is a stronger check than the differential harness makes, and it is worth
// being precise about why. The harness compares the engine against the payload
// it arrived WITH — both describing the same, settled world. This compares a
// prediction made BEFORE a mutation against the answer that came back after it,
// which is where a derivation that is right at rest and wrong after equipping
// armour finally shows itself.
export function checkPredictions(
  actorId: string | undefined,
  actor: Ref<TablemateCharacter | undefined>,
  stamp: string | undefined
): PredictionMiss[] {
  if (!actorId) return []
  const predicted = snapshots.get(actorId)
  if (!predicted) return []
  const found: PredictionMiss[] = []

  for (const figure of derivableFigures(actor, stamp)) {
    if (!predicted.has(figure.key)) continue
    const reported = figure.reported()
    // A figure the payload does not report is not a miss — there is nothing to
    // have been wrong about.
    if (reported === undefined || reported === null) continue
    const ours = predicted.get(figure.key)
    if (ours === undefined) continue
    if (comparable(ours) === comparable(reported)) continue
    found.push({ key: figure.key, predicted: ours, reported })
  }

  if (found.length) {
    misses.push(...found)
    if (misses.length > MAX_RETAINED) misses.splice(0, misses.length - MAX_RETAINED)
    logger.warn(
      'TM: prediction missed —',
      found
        .map((m) => `${m.key}: said ${comparable(m.predicted)}, got ${comparable(m.reported)}`)
        .join('; ')
    )
  }
  // The payload is canonical again, so the snapshot restarts from it: a
  // prediction is only ever compared against the FIRST payload after the write
  // that produced it.
  snapshots.delete(actorId)
  return found
}

// A statistic's payload copy is an object with a total buried in it; ours is
// the total. Compare on the number where there is one, and on the JSON
// otherwise, so the two shapes can meet.
function comparable(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['totalModifier', 'value', 'max', 'dc']) {
      if (typeof record[key] === 'number') return String(record[key])
    }
    return JSON.stringify(value)
  }
  return String(value)
}

export function predictionMisses(): PredictionMiss[] {
  return [...misses]
}

// Called when an actor's sheet closes or the world changes: a prediction about
// a world we are no longer connected to is not worth keeping.
export function forgetPredictions(actorId?: string): void {
  if (actorId) snapshots.delete(actorId)
  else snapshots.clear()
}
