import { describe, it, expect } from 'vitest'
import {
  collapseGmHandlerPolicy,
  normalizeGmHandlerPolicy,
  gmHandlerRank,
  gmHandlesRequests,
  compareGmHandlers,
  type GmHandlerPolicy,
  type HandlerUser
} from '@/foundry/gmHandlerSetting'

// The world's GM handler policy decides which GM client handles a Tablemate
// request. These tests pin the two things listener.ts relies on: an unconfigured
// (or unlisted) GM keeps the old default of "eligible, ordered by id", and an
// explicit policy both reorders and opts out.

const alice: HandlerUser = { _id: 'aaa' }
const bob: HandlerUser = { _id: 'bbb' }
const carol: HandlerUser = { _id: 'ccc' }

const policy = (order: string[] = [], ignored: string[] = []): GmHandlerPolicy =>
  normalizeGmHandlerPolicy({ order, ignored })

// The election in listener.ts, expressed against the same comparator: the
// highest-priority eligible GM among those passed in (i.e. the active ones).
function elect(users: HandlerUser[], p: GmHandlerPolicy): HandlerUser | undefined {
  return users
    .filter((user) => gmHandlesRequests(user, p))
    .sort((a, b) => compareGmHandlers(a, b, p))[0]
}

describe('normalizeGmHandlerPolicy', () => {
  it('treats a missing or malformed value as no policy', () => {
    expect(normalizeGmHandlerPolicy(undefined)).toEqual({ order: [], ignored: [] })
    expect(normalizeGmHandlerPolicy({ order: 'bbb', ignored: 7 })).toEqual({
      order: [],
      ignored: []
    })
  })

  it('drops non-string and empty ids, and de-duplicates', () => {
    expect(normalizeGmHandlerPolicy({ order: ['bbb', '', 3, 'bbb', 'aaa'] }).order).toEqual([
      'bbb',
      'aaa'
    ])
  })

  it('never leaves an opted-out GM in the priority order', () => {
    expect(normalizeGmHandlerPolicy({ order: ['aaa', 'ccc'], ignored: ['ccc'] })).toEqual({
      order: ['aaa'],
      ignored: ['ccc']
    })
  })
})

describe('collapseGmHandlerPolicy', () => {
  it('drops an explicit order that just repeats the by-id default', () => {
    expect(collapseGmHandlerPolicy(policy(['aaa', 'bbb', 'ccc']))).toEqual({
      order: [],
      ignored: []
    })
  })

  it('keeps a genuinely reordered list', () => {
    expect(collapseGmHandlerPolicy(policy(['bbb', 'aaa'])).order).toEqual(['bbb', 'aaa'])
  })

  it('keeps a by-id order when someone is opted out', () => {
    // The opt-out is the payload here; the order must not be thrown away with it.
    expect(collapseGmHandlerPolicy(policy(['aaa', 'bbb'], ['ccc']))).toEqual({
      order: ['aaa', 'bbb'],
      ignored: ['ccc']
    })
  })
})

describe('gmHandlerRank', () => {
  it('ranks listed users by list position', () => {
    const p = policy(['bbb', 'aaa'])
    expect(gmHandlerRank(bob, p)).toBe(0)
    expect(gmHandlerRank(alice, p)).toBe(1)
  })

  it('ranks unlisted users after every listed one', () => {
    expect(gmHandlerRank(carol, policy(['bbb', 'aaa']))).toBe(2)
  })

  it('accepts a document-style id as well as a source _id', () => {
    expect(gmHandlerRank({ id: 'ccc' }, policy(['ccc']))).toBe(0)
  })
})

describe('gmHandlesRequests', () => {
  it('lets everyone handle requests with no policy', () => {
    expect(gmHandlesRequests(alice, policy())).toBe(true)
    expect(gmHandlesRequests(carol, policy())).toBe(true)
  })

  it('excludes only the opted-out user', () => {
    const p = policy([], ['ccc'])
    expect(gmHandlesRequests(carol, p)).toBe(false)
    expect(gmHandlesRequests(alice, p)).toBe(true)
  })

  it('treats a missing user as unable to handle requests', () => {
    expect(gmHandlesRequests(undefined, policy())).toBe(false)
  })
})

describe('handler election', () => {
  it('picks the lowest id when unconfigured', () => {
    expect(elect([carol, bob, alice], policy())).toBe(alice)
  })

  it('breaks ties by codepoint, not locale collation', () => {
    // 'B'.localeCompare('a') is negative under locale rules but 'B' < 'a' by
    // codepoint; clients must agree, so the codepoint order is the contract.
    expect(compareGmHandlers({ _id: 'B' }, { _id: 'a' }, policy())).toBeLessThan(0)
  })

  it('honors an explicit priority order over id order', () => {
    expect(elect([alice, bob, carol], policy(['bbb']))).toBe(bob)
    expect(elect([alice, bob, carol], policy(['ccc', 'bbb']))).toBe(carol)
  })

  it('falls through to the next priority when the leader is offline', () => {
    // Only the online GMs are passed in, mirroring the user.active filter.
    expect(elect([alice, carol], policy(['bbb', 'aaa']))).toBe(alice)
  })

  it('skips an opted-out GM even when they would otherwise win', () => {
    expect(elect([alice, bob], policy([], ['aaa']))).toBe(bob)
  })

  it('leaves nobody to handle requests when the only online GM is opted out', () => {
    expect(elect([alice], policy([], ['aaa']))).toBeUndefined()
  })
})
