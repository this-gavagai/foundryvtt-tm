import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DICE_REVEAL_MAX_MS } from '@/api/protocol'
import {
  diceRevealHeld,
  HIDDEN_TAB_REVEAL_MS,
  isDiceRevealSetting,
  resetDiceRevealForTest,
  REVEAL_CEILING_MS,
  settleRequestDice,
  trackDiceReveal
} from '@/foundry/diceReveal'
import type { ChatOrigin } from '@/foundry/chatOrigin'

// A Dice So Nice that finishes each card when the test says so — standing in for
// `waitFor3DAnimationByMessageID`, which resolves on DSN's diceSoNiceRollComplete.
let landings: Map<string, () => void>
let dsnActive: boolean
let immediate: unknown

function installGame() {
  landings = new Map()
  ;(globalThis as Record<string, unknown>).game = {
    modules: { get: (id: string) => (id === 'dice-so-nice' ? { active: dsnActive } : undefined) },
    settings: {
      get: (scope: string, key: string) => {
        if (scope === 'dice-so-nice' && key === 'immediatelyDisplayChatMessages') return immediate
        throw new Error(`unregistered ${scope}.${key}`)
      }
    },
    dice3d: {
      waitFor3DAnimationByMessageID: (id: string) =>
        new Promise<boolean>((resolve) => landings.set(id, () => resolve(true)))
    }
  }
}

// Just enough of `document` for the visibility rule.
let page: { hidden: boolean; listeners: Set<() => void> }
function installDocument(hidden = false) {
  page = { hidden, listeners: new Set() }
  ;(globalThis as Record<string, unknown>).document = {
    get hidden() {
      return page.hidden
    },
    addEventListener: (_: string, listener: () => void) => page.listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => page.listeners.delete(listener)
  }
}
function setHidden(hidden: boolean) {
  page.hidden = hidden
  page.listeners.forEach((listener) => listener())
}

const card = (id: string, rolls: unknown[] = [{}]) => ({ id, rolls })
const origin = (): ChatOrigin => ({ userId: 'player-1', uuid: 'req-1' })

async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  dsnActive = true
  immediate = false
  installGame()
  installDocument()
  resetDiceRevealForTest()
})
afterEach(() => {
  vi.useRealTimers()
  delete (globalThis as Record<string, unknown>).game
  delete (globalThis as Record<string, unknown>).document
})

describe('whether Dice So Nice is holding cards back', () => {
  it('is while DSN is active and the world has not asked for cards immediately', () => {
    expect(diceRevealHeld()).toBe(true)
  })

  it('is not when the world shows chat messages immediately', () => {
    immediate = true
    expect(diceRevealHeld()).toBe(false)
  })

  it('is not when DSN is inactive', () => {
    dsnActive = false
    expect(diceRevealHeld()).toBe(false)
  })

  it('recognises its world switch among Setting documents', () => {
    expect(isDiceRevealSetting({ key: 'dice-so-nice.immediatelyDisplayChatMessages' })).toBe(true)
    expect(isDiceRevealSetting({ key: 'dice-so-nice.enabled' })).toBe(false)
    expect(isDiceRevealSetting(undefined)).toBe(false)
  })
})

describe('a new roll card', () => {
  it('is announced when DSN has thrown its dice', async () => {
    const onRevealed = vi.fn()
    trackDiceReveal(card('msg-1'), undefined, onRevealed)
    await flush()
    expect(onRevealed).not.toHaveBeenCalled()

    landings.get('msg-1')!()
    await flush()
    expect(onRevealed).toHaveBeenCalledExactlyOnceWith('msg-1')
  })

  it('is not tracked when it carries no rolls', () => {
    const onRevealed = vi.fn()
    trackDiceReveal(card('msg-1', []), undefined, onRevealed)
    expect(landings.size).toBe(0)
  })

  it('is not tracked when DSN is not holding cards', () => {
    immediate = true
    trackDiceReveal(card('msg-1'), undefined, vi.fn())
    expect(landings.size).toBe(0)
  })

  // DSN queues the throw in a background tab rather than animating it, so
  // waiting for it would hold the table's cards for as long as the tab is away.
  it('is released after the hidden-tab allowance when this tab is in the background', async () => {
    installDocument(true)
    const onRevealed = vi.fn()
    trackDiceReveal(card('msg-1'), undefined, onRevealed)

    await vi.advanceTimersByTimeAsync(HIDDEN_TAB_REVEAL_MS - 1)
    expect(onRevealed).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onRevealed).toHaveBeenCalledOnce()
  })

  it('goes back to waiting for the dice when the tab is shown again in time', async () => {
    installDocument(true)
    const onRevealed = vi.fn()
    trackDiceReveal(card('msg-1'), undefined, onRevealed)

    // Shown again a second before the allowance runs out, then waited on past
    // where it would have — but not as far as the ceiling.
    await vi.advanceTimersByTimeAsync(HIDDEN_TAB_REVEAL_MS - 1000)
    setHidden(false)
    await vi.advanceTimersByTimeAsync(1500)
    expect(onRevealed).not.toHaveBeenCalled()

    landings.get('msg-1')!()
    await flush()
    expect(onRevealed).toHaveBeenCalledOnce()
  })

  it('starts the hidden-tab allowance when the tab is hidden mid-throw', async () => {
    const onRevealed = vi.fn()
    trackDiceReveal(card('msg-1'), undefined, onRevealed)
    await vi.advanceTimersByTimeAsync(1000)
    setHidden(true)

    await vi.advanceTimersByTimeAsync(HIDDEN_TAB_REVEAL_MS)
    expect(onRevealed).toHaveBeenCalledOnce()
  })

  it('is released at the ceiling if DSN never reports', async () => {
    const onRevealed = vi.fn()
    trackDiceReveal(card('msg-1'), undefined, onRevealed)

    await vi.advanceTimersByTimeAsync(REVEAL_CEILING_MS - 1)
    expect(onRevealed).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onRevealed).toHaveBeenCalledOnce()
  })

  // Released here, the card (and any ack waiting on it) still has a round trip
  // to reach the app before the app's own ceiling.
  it('stops waiting short of the app’s ceiling', () => {
    expect(REVEAL_CEILING_MS).toBeLessThan(DICE_REVEAL_MAX_MS)
    expect(HIDDEN_TAB_REVEAL_MS).toBeLessThan(REVEAL_CEILING_MS)
  })
})

describe('the roll cards a request posted', () => {
  it('are handed back once their dice have landed', async () => {
    const request = origin()
    trackDiceReveal(card('msg-1'), request, vi.fn())
    trackDiceReveal(card('msg-2'), request, vi.fn())

    let settled: string[] | undefined
    void settleRequestDice(request, true).then((ids) => (settled = ids))
    landings.get('msg-1')!()
    await flush()
    expect(settled).toBeUndefined()

    landings.get('msg-2')!()
    await flush()
    expect(settled).toEqual(['msg-1', 'msg-2'])
  })

  it('are handed back at once when told not to wait', async () => {
    const request = origin()
    trackDiceReveal(card('msg-1'), request, vi.fn())
    await expect(settleRequestDice(request, false)).resolves.toEqual(['msg-1'])
  })

  it('are none for a request that posted no roll card', async () => {
    await expect(settleRequestDice(origin(), true)).resolves.toEqual([])
  })
})
