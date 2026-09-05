import { describe, it, expect } from 'vitest'
import {
  describeDuration,
  durationBadge,
  durationLabel,
  remainingSeconds
} from '@/utils/effectDuration'

// Ported from PF2e's calculateRemainingDuration, so the cases that matter are
// the ones where a paraphrase would drift from it:
//
//   * durations are anchored to the WORLD CLOCK in seconds, not to the encounter
//     round — the round is just six of those seconds;
//   * `unlimited` and `encounter` are not counted at all, and an effect with no
//     start stamp is treated as unlimited rather than as already expired;
//   * the count rounds UP, so an effect still working never reads as 0.

const start = (value: number) => ({ value, initiative: null })

describe('remainingSeconds', () => {
  it('measures the duration against the world clock', () => {
    // Started at t=100, runs 3 rounds (18s), clock now at 106 → 12s left.
    expect(remainingSeconds({ value: 3, unit: 'rounds' }, start(100), 106)).toBe(12)
  })

  it('handles every unit PF2e counts in', () => {
    expect(remainingSeconds({ value: 1, unit: 'rounds' }, start(0), 0)).toBe(6)
    expect(remainingSeconds({ value: 1, unit: 'minutes' }, start(0), 0)).toBe(60)
    expect(remainingSeconds({ value: 1, unit: 'hours' }, start(0), 0)).toBe(3600)
    expect(remainingSeconds({ value: 1, unit: 'days' }, start(0), 0)).toBe(86400)
  })

  it('goes negative once the clock has passed it', () => {
    expect(remainingSeconds({ value: 1, unit: 'rounds' }, start(100), 130)).toBe(-24)
  })

  it('does not count what PF2e does not count', () => {
    expect(remainingSeconds({ value: 0, unit: 'unlimited' }, start(100), 200)).toBeNull()
    expect(remainingSeconds({ value: 0, unit: 'encounter' }, start(100), 200)).toBeNull()
    expect(remainingSeconds(undefined, start(100), 200)).toBeNull()
    expect(remainingSeconds({ value: 1, unit: 'fortnights' }, start(100), 200)).toBeNull()
  })

  it('treats an unstamped effect as uncounted, not as expired', () => {
    // No `start` means it never began against a clock — a synthesised in-memory
    // condition, or a feat sitting in the same panel. Counting from zero would
    // report every one of them as long expired.
    expect(remainingSeconds({ value: 3, unit: 'rounds' }, undefined, 200)).toBeNull()
    expect(remainingSeconds({ value: 3, unit: 'rounds' }, start(100), undefined)).toBeNull()
  })
})

describe('describeDuration', () => {
  it('reports whole units of the duration it was written in', () => {
    expect(describeDuration({ value: 3, unit: 'rounds' }, start(100), 100)).toEqual({
      kind: 'timed',
      unit: 'rounds',
      value: 3,
      expired: false
    })
  })

  it('rounds up, so an effect that still works never reads as none left', () => {
    // 4 seconds into the last round: 2s remain, which is still a round you have.
    expect(describeDuration({ value: 1, unit: 'rounds' }, start(100), 104)).toMatchObject({
      value: 1,
      expired: false
    })
    // Part-way through a 10-minute effect.
    expect(describeDuration({ value: 10, unit: 'minutes' }, start(0), 61)).toMatchObject({
      value: 9
    })
  })

  it('marks a clock that has run out', () => {
    expect(describeDuration({ value: 1, unit: 'rounds' }, start(100), 106)).toMatchObject({
      value: 0,
      expired: true
    })
    expect(describeDuration({ value: 1, unit: 'rounds' }, start(100), 200)).toMatchObject({
      expired: true
    })
  })

  it('names an encounter duration rather than counting it', () => {
    expect(describeDuration({ value: 0, unit: 'encounter' }, start(100), 200)).toEqual({
      kind: 'encounter'
    })
  })

  it('says nothing for an effect with no clock', () => {
    expect(describeDuration({ value: 0, unit: 'unlimited' }, start(100), 200)).toEqual({
      kind: 'none'
    })
    expect(describeDuration(undefined, undefined, 200)).toEqual({ kind: 'none' })
  })
})

describe('the labels', () => {
  const timed = (unit: string, value: number, expired = false) =>
    ({ kind: 'timed', unit, value, expired }) as const

  it('gives the modal a phrase and the chip an abbreviation', () => {
    expect(durationLabel(timed('rounds', 2))).toEqual({
      key: 'effects.duration.rounds',
      params: { count: 2 }
    })
    expect(durationBadge(timed('rounds', 2))).toEqual({
      key: 'effects.duration.shortRounds',
      params: { count: 2 }
    })
    expect(durationBadge(timed('minutes', 10))).toMatchObject({
      key: 'effects.duration.shortMinutes'
    })
  })

  it('leaves an encounter duration off the chip, where it cannot be a number', () => {
    expect(durationLabel({ kind: 'encounter' })).toEqual({ key: 'effects.duration.encounter' })
    expect(durationBadge({ kind: 'encounter' })).toBeNull()
  })

  it('says nothing at all for an effect with no clock', () => {
    expect(durationLabel({ kind: 'none' })).toBeNull()
    expect(durationBadge({ kind: 'none' })).toBeNull()
  })

  it('marks an expired clock in both places', () => {
    expect(durationLabel(timed('rounds', 0, true))).toEqual({ key: 'effects.duration.expired' })
    expect(durationBadge(timed('rounds', 0, true))).toEqual({
      key: 'effects.duration.shortExpired'
    })
  })
})
