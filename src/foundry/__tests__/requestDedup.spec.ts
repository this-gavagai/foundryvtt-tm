import { describe, it, expect, beforeEach } from 'vitest'
import {
  markRequestSeen,
  requestAlreadySeen,
  resetRequestDedupForTest
} from '@/foundry/requestDedup'

// The dedup guard is what stops an ambiguous proxy/fallback-GM election from
// double-executing a mutation: a client marks a uuid when it starts (or sees
// another client's ack for) a request, and skips uuids already seen within
// the TTL. These tests pin the seen/unseen logic and the TTL pruning.

const TTL = 5 * 60 * 1000
const T0 = 1_000_000

beforeEach(() => {
  resetRequestDedupForTest()
})

describe('requestAlreadySeen', () => {
  it('is false for a uuid never marked', () => {
    expect(requestAlreadySeen('unseen', T0)).toBe(false)
  })

  it('is true once marked, within the TTL', () => {
    markRequestSeen('req-1', T0)
    expect(requestAlreadySeen('req-1', T0)).toBe(true)
    expect(requestAlreadySeen('req-1', T0 + TTL)).toBe(true)
  })

  it('expires after the TTL', () => {
    markRequestSeen('req-1', T0)
    expect(requestAlreadySeen('req-1', T0 + TTL + 1)).toBe(false)
  })

  it('keeps the FIRST seen time on repeat marks (an ack after a local start must not extend the window)', () => {
    markRequestSeen('req-1', T0)
    markRequestSeen('req-1', T0 + TTL) // late duplicate observation
    expect(requestAlreadySeen('req-1', T0 + TTL + 1)).toBe(false)
  })
})

describe('pruning', () => {
  it('drops expired entries as new ones are marked', () => {
    markRequestSeen('old-1', T0)
    markRequestSeen('old-2', T0 + 1)
    markRequestSeen('fresh', T0 + TTL + 2) // prunes old-1/old-2 on insert
    expect(requestAlreadySeen('old-1', T0 + TTL + 2)).toBe(false)
    expect(requestAlreadySeen('fresh', T0 + TTL + 2)).toBe(true)
  })

  it('stops pruning at the first live entry (insertion order is ascending)', () => {
    markRequestSeen('a', T0)
    markRequestSeen('b', T0 + TTL) // still live when 'c' arrives
    markRequestSeen('c', T0 + TTL + 500)
    expect(requestAlreadySeen('a', T0 + TTL + 500)).toBe(false)
    expect(requestAlreadySeen('b', T0 + TTL + 500)).toBe(true)
    expect(requestAlreadySeen('c', T0 + TTL + 500)).toBe(true)
  })
})
