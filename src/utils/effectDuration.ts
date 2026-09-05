// How long an effect has left, from the three facts the wire carries.
//
// PF2e anchors a duration to the WORLD CLOCK, not to the encounter round. An
// effect records `system.start.value` — `game.time.worldTime` in seconds at the
// moment it was created (EffectPF2e#_preCreate writes it into source, which is
// why it survives toObject()) — and `system.duration` says how long it runs for.
// What remains is arithmetic against the current world time:
//
//     remaining = start + value × secondsPerUnit − worldTime
//
// This is a port of PF2e's `calculateRemainingDuration`, and deliberately not
// all of it. PF2e's version has a tie-break for the single tick where remaining
// is exactly 0, deciding whether an effect whose time is up expires at the
// holder's turn start, their turn end, or the round end — it needs the live
// encounter, the combatant's initiative and the effect's origin actor to do it.
// That decision belongs to the client that will actually delete the effect. The
// sheet is only saying "about this much left", and an effect that has run out is
// removed by PF2e, which reaches the app as an item update like any other.
//
// So `expired` here means "the clock has run out", not "PF2e has retired it".
// The one thing the sheet must not do is show a stale positive number, and that
// it cannot: remaining is derived from a world clock the app tracks live.

// PF2e's own unit table (the `pl` map beside calculateRemainingDuration). A
// round is six seconds, which is what makes the round the natural display unit
// for anything short.
export const SECONDS_PER_UNIT: Record<string, number> = {
  rounds: 6,
  minutes: 60,
  hours: 3600,
  days: 86400
}

export interface EffectDurationData {
  value?: number | null
  unit?: string | null
  expiry?: string | null
}

export interface EffectStartData {
  value?: number | null
  initiative?: number | null
}

/**
 * What to show beside an effect's name.
 *
 * `unlimited` carries no readout at all — an effect that runs until something
 * removes it is the ordinary case, and a badge saying so on every row would be
 * noise on the one screen with the least room for it.
 *
 * `encounter` is a duration the app cannot count: PF2e answers it from
 * `system.expired`, which is derived on the Foundry side and not on the wire.
 * The label says what it is instead of inventing a number.
 *
 * `timed` is the countable case, already reduced to whole units of `unit`.
 * `expired` marks a clock that has run out but whose effect is still on the
 * sheet — PF2e removes those at the turn boundary it belongs to, so this is what
 * the gap between "time is up" and "the system has noticed" looks like.
 */
export type EffectDuration =
  | { kind: 'none' }
  | { kind: 'encounter' }
  | { kind: 'timed'; unit: string; value: number; expired: boolean }

/**
 * Seconds left on an effect, or null when it isn't running against the clock
 * (unlimited, encounter-scoped, or never stamped with a start).
 *
 * An effect with no `start` is one that was never created on an actor in a world
 * with a clock — a compendium entry, or a payload from before PF2e stamped it.
 * PF2e treats that as unlimited rather than as already expired, and so does this.
 */
export function remainingSeconds(
  duration: EffectDurationData | undefined,
  start: EffectStartData | undefined,
  worldTime: number | undefined
): number | null {
  const unit = duration?.unit
  if (!unit || unit === 'unlimited' || unit === 'encounter') return null
  const perUnit = SECONDS_PER_UNIT[unit]
  if (perUnit === undefined) return null
  const startedAt = start?.value
  if (typeof startedAt !== 'number' || typeof worldTime !== 'number') return null
  return startedAt + (duration?.value ?? 0) * perUnit - worldTime
}

/**
 * The readout for one effect, in the unit its duration was written in.
 *
 * Rounding is UP, deliberately: four seconds into a six-second round, a Haste
 * with one round left has 2 seconds on the clock, and a player reading "0
 * rounds" on an effect that is still working would be reading a lie. Ceiling
 * says "you have this round", which is how the table plays it.
 */
export function describeDuration(
  duration: EffectDurationData | undefined,
  start: EffectStartData | undefined,
  worldTime: number | undefined
): EffectDuration {
  const unit = duration?.unit
  if (unit === 'encounter') return { kind: 'encounter' }
  // Establishing the unit FIRST is what lets the rest of this function read it
  // without a fallback: past this guard it is a string and a key of the table,
  // which is exactly the condition remainingSeconds returns a number under. The
  // check is stated twice rather than asserted once, because a `!` here would
  // claim a fact the compiler cannot see and would keep claiming it if either
  // function's rule moved.
  if (!unit || SECONDS_PER_UNIT[unit] === undefined) return { kind: 'none' }

  const remaining = remainingSeconds(duration, start, worldTime)
  if (remaining === null) return { kind: 'none' }

  if (remaining <= 0) return { kind: 'timed', unit, value: 0, expired: true }
  return {
    kind: 'timed',
    unit,
    value: Math.ceil(remaining / SECONDS_PER_UNIT[unit]),
    expired: false
  }
}

// ── Labels ───────────────────────────────────────────────────────────────────
//
// The i18n key and its interpolation, rather than a formatted string: the
// catalogs own the wording, and returning the pair keeps this file free of a
// translator while staying unit-testable. Null means "say nothing", which is
// what an effect with no clock gets.
//
// Counts are interpolated plainly, with no plural forms, because no catalog in
// this app has ever used them (`{count} messages` reads the same way). Adding
// vue-i18n pluralization here would put a three-form Russian plural and a
// two-form German one in front of three translators for a badge that is two
// characters wide.
export interface DurationLabel {
  key: string
  params?: Record<string, number>
}

const UNIT_KEY: Record<string, string> = {
  rounds: 'rounds',
  minutes: 'minutes',
  hours: 'hours',
  days: 'days'
}

/** The full phrase, for the info modal, where there is room for words. */
export function durationLabel(duration: EffectDuration): DurationLabel | null {
  if (duration.kind === 'none') return null
  if (duration.kind === 'encounter') return { key: 'effects.duration.encounter' }
  if (duration.expired) return { key: 'effects.duration.expired' }
  const unit = UNIT_KEY[duration.unit]
  if (!unit) return null
  return { key: `effects.duration.${unit}`, params: { count: duration.value } }
}

/**
 * The two-character badge for the effect chip, which is 38px wide and already
 * carries an icon and a name.
 *
 * Encounter durations get nothing here: "until the encounter ends" does not
 * abbreviate to a number, and a chip badge that means something different from
 * every other chip badge is worse than an absent one. The modal says it.
 */
export function durationBadge(duration: EffectDuration): DurationLabel | null {
  if (duration.kind !== 'timed') return null
  if (duration.expired) return { key: 'effects.duration.shortExpired' }
  const unit = UNIT_KEY[duration.unit]
  if (!unit) return null
  const short = unit.charAt(0).toUpperCase() + unit.slice(1)
  return { key: `effects.duration.short${short}`, params: { count: duration.value } }
}
