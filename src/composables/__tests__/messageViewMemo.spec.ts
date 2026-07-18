import { describe, it, expect, vi } from 'vitest'
import { makeMessageViewMemo, type ExpensiveMessageView } from '@/composables/useChatMessages'

// The memo is what keeps a combat tick from re-parsing the whole chat log: the
// world shallowRef is force-triggered on every modifyDocument, so
// renderedMessages re-runs over every visible message, but each message's
// expensive HTML build must only re-run when that message's own inputs change.
// These tests pin that reuse/invalidate/prune behavior on the pure cache.

const view = (tag: string): ExpensiveMessageView => ({
  preparedContent: tag,
  preparedFlavor: undefined,
  showContent: true,
  showEmptyMessage: false,
  rerollSummary: undefined,
  rolls: [],
  inlineChecks: []
})

describe('makeMessageViewMemo', () => {
  it('computes once, then reuses while the fingerprint is unchanged', () => {
    const memo = makeMessageViewMemo()
    const compute = vi.fn(() => view('built'))

    const first = memo.get('msg-1', 'fp-a', compute)
    const second = memo.get('msg-1', 'fp-a', compute)

    expect(compute).toHaveBeenCalledTimes(1)
    expect(second).toBe(first) // same object reference reused
  })

  it('recomputes when the fingerprint changes (e.g. an edited/rerolled message)', () => {
    const memo = makeMessageViewMemo()
    const compute = vi.fn((): ExpensiveMessageView => view('v'))

    memo.get('msg-1', 'fp-a', compute)
    memo.get('msg-1', 'fp-b', compute) // content changed → new fingerprint

    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('keys per message id — different messages do not collide', () => {
    const memo = makeMessageViewMemo()
    const compute = vi.fn((): ExpensiveMessageView => view('v'))

    memo.get('msg-1', 'fp', compute)
    memo.get('msg-2', 'fp', compute) // same fingerprint text, different id

    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('always recomputes for an id-less message (never cacheable)', () => {
    const memo = makeMessageViewMemo()
    const compute = vi.fn((): ExpensiveMessageView => view('v'))

    memo.get(undefined, 'fp', compute)
    memo.get(undefined, 'fp', compute)

    expect(compute).toHaveBeenCalledTimes(2)
    expect(memo.size).toBe(0)
  })

  it('prune drops entries for messages no longer visible', () => {
    const memo = makeMessageViewMemo()
    const compute = () => view('v')

    memo.get('keep', 'fp', compute)
    memo.get('drop', 'fp', compute)
    expect(memo.size).toBe(2)

    memo.prune(new Set(['keep']))
    expect(memo.size).toBe(1)

    // The dropped entry is gone: re-getting it recomputes; the kept one reuses.
    const keepCompute = vi.fn(() => view('keep'))
    const dropCompute = vi.fn(() => view('drop'))
    memo.get('keep', 'fp', keepCompute)
    memo.get('drop', 'fp', dropCompute)
    expect(keepCompute).not.toHaveBeenCalled()
    expect(dropCompute).toHaveBeenCalledTimes(1)
  })
})
