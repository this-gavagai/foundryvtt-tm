import { describe, it, expect } from 'vitest'
import {
  USER_REACTION_MAX,
  normalizeUserReactions,
  reactionWritePlan,
  reactionsToStored
} from '@/utils/chatReactions'

// A tap used to rewrite this user's entire reaction list and broadcast it to the
// table — the only thing bounding that cost was the cap. Reactions are stored as
// a map keyed by message id now, so a tap writes the one row it changed.
//
// The map was only possible once the merge could express a removal (Foundry
// broadcasts `-=<id>` when a key goes; see mergeDocumentChange), which is why
// the patch below leans on that syntax rather than avoiding it.

const rows = (n: number, from = 0) =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i) => [`m${from + i}`, { e: ['👍'], t: from + i }])
  )

describe('adding a reaction', () => {
  it('writes only the row that changed', () => {
    const stored = rows(3)
    const { patch } = reactionWritePlan(stored, 'm1', ['👍', '🎲'], 500)
    expect(patch).toEqual({ m1: { e: ['👍', '🎲'], t: 1 } })
  })

  it('keeps the row’s original timestamp, so an old message is not promoted', () => {
    const { patch } = reactionWritePlan({ m0: { e: ['👍'], t: 5 } }, 'm0', ['👍', '❤️'], 999)
    expect((patch.m0 as { t: number }).t).toBe(5)
  })

  it('stamps a new row with now, so the trim has an order to work in', () => {
    const { patch } = reactionWritePlan({ m0: { e: ['👍'], t: 5 } }, 'm9', ['🎉'], 999)
    expect(patch.m9).toEqual({ e: ['🎉'], t: 999 })
  })

  it('drops an emoji outside the palette rather than storing it', () => {
    const { next } = reactionWritePlan({}, 'm1', ['👍', '💀'], 1)
    expect(next.m1.e).toEqual(['👍'])
  })
})

describe('removing the last reaction on a message', () => {
  it('names the row for deletion instead of rewriting the list', () => {
    const { patch } = reactionWritePlan(rows(3), 'm1', [], 500)
    expect(patch).toEqual({ '-=m1': null })
  })

  it('leaves every other row untouched', () => {
    const { next } = reactionWritePlan(rows(3), 'm1', [], 500)
    expect(Object.keys(next).sort()).toEqual(['m0', 'm2'])
  })

  it('is a no-op patch for a message that was not reacted to', () => {
    const { patch } = reactionWritePlan(rows(2), 'never', [], 500)
    expect(patch).toEqual({})
  })
})

describe('the rollover from the flat array', () => {
  // Merging a map into an array is not a merge, so the first write after the
  // change replaces the value outright. Once per user, then patches forever.
  it('replaces the flag wholesale when it still holds an array', () => {
    const legacy = [
      { messageId: 'm0', emoji: '👍' },
      { messageId: 'm1', emoji: '🎲' }
    ]
    const { patch, whole } = reactionWritePlan(legacy, 'm1', ['🎲', '❤️'], 500)
    expect(whole).toBe(true)
    expect(Object.keys(patch).sort()).toEqual(['m0', 'm1'])
    expect((patch.m1 as { e: string[] }).e).toEqual(['🎲', '❤️'])
  })

  it('loses nothing that was in the array', () => {
    const legacy = [
      { messageId: 'm0', emoji: '👍' },
      { messageId: 'm0', emoji: '❤️' },
      { messageId: 'm1', emoji: '🎲' }
    ]
    const { next } = reactionWritePlan(legacy, 'm2', ['🎉'], 500)
    expect(next.m0.e).toEqual(['👍', '❤️'])
    expect(next.m1.e).toEqual(['🎲'])
    expect(next.m2.e).toEqual(['🎉'])
  })

  it('reads an array and a map back to the same reactions', () => {
    const legacy = [
      { messageId: 'm0', emoji: '👍' },
      { messageId: 'm1', emoji: '🎲' }
    ]
    expect(normalizeUserReactions(reactionsToStored(normalizeUserReactions(legacy)))).toEqual(
      normalizeUserReactions(legacy)
    )
  })

  it('starts a map for a user who has never reacted', () => {
    const { patch, whole } = reactionWritePlan(undefined, 'm1', ['👍'], 7)
    expect(whole).toBe(true)
    expect(patch).toEqual({ m1: { e: ['👍'], t: 7 } })
  })
})

describe('the cap', () => {
  it('names the rows it pushed out for deletion, alongside the new one', () => {
    const stored = rows(USER_REACTION_MAX)
    const { patch, next } = reactionWritePlan(stored, 'newest', ['👍'], 10_000)

    expect(Object.keys(next)).toHaveLength(USER_REACTION_MAX)
    expect(patch.newest).toEqual({ e: ['👍'], t: 10_000 })
    // The oldest row goes, and the patch says so rather than leaving it on the
    // server for the next reader to trim again.
    expect(patch['-=m0']).toBeNull()
    expect(next.m0).toBeUndefined()
  })

  it('drops by timestamp, not by key order', () => {
    // Keys inserted newest-first: a trim that trusted insertion order would take
    // the wrong end.
    const stored = { late: { e: ['👍'], t: 900 }, early: { e: ['👍'], t: 1 } }
    const trimmed = normalizeUserReactions(stored)
    expect(trimmed.map((r) => r.messageId)).toEqual(['early', 'late'])
  })

  it('counts a message once however many emoji it carries', () => {
    const { next } = reactionWritePlan({}, 'm1', ['👍', '❤️', '🎲'], 1)
    expect(Object.keys(next)).toEqual(['m1'])
  })
})
