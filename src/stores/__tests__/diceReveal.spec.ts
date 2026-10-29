import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useDiceRevealStore } from '@/stores/diceReveal'
import { useListenersStore } from '@/stores/listenersOnline'
import { useVersionCompatStore } from '@/stores/versionCompat'
import { CAPABILITY_DICE_REVEAL, DICE_REVEAL_MAX_MS, PROTOCOL_VERSION } from '@/api/protocol'

// Roll cards stay out of the chat log until the module says the table's dice
// have landed — but only while there is a module that will say so.

function announce(capabilities: string[] = [CAPABILITY_DICE_REVEAL]) {
  useListenersStore().addListener('gm-1')
  useVersionCompatStore().reportModule(PROTOCOL_VERSION, '1.0.0', capabilities)
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('holding a roll card', () => {
  it('holds it until its release arrives', () => {
    announce()
    const store = useDiceRevealStore()

    store.hold('msg-1')
    expect(store.isHeld('msg-1')).toBe(true)

    store.release('msg-1')
    expect(store.isHeld('msg-1')).toBe(false)
  })

  it('holds nothing when the module does not hold cards back', () => {
    announce([])
    const store = useDiceRevealStore()

    store.hold('msg-1')
    expect(store.isHeld('msg-1')).toBe(false)
  })

  it('holds nothing with nobody listening to release it', () => {
    useVersionCompatStore().reportModule(PROTOCOL_VERSION, '1.0.0', [CAPABILITY_DICE_REVEAL])
    const store = useDiceRevealStore()

    store.hold('msg-1')
    expect(store.isHeld('msg-1')).toBe(false)
  })

  // The ack for the player's own roll can beat the card's create broadcast.
  it('does not hold a card whose release arrived first', () => {
    announce()
    const store = useDiceRevealStore()

    store.release('msg-1')
    store.hold('msg-1')
    expect(store.isHeld('msg-1')).toBe(false)
  })

  // The player never waits longer than this for a result, release or not.
  it('lets a card go at the ceiling if its release never arrives', () => {
    announce()
    const store = useDiceRevealStore()

    store.hold('msg-1')
    vi.advanceTimersByTime(DICE_REVEAL_MAX_MS - 1)
    expect(store.isHeld('msg-1')).toBe(true)
    vi.advanceTimersByTime(1)
    expect(store.isHeld('msg-1')).toBe(false)
  })

  it('never holds a card longer than five seconds', () => {
    expect(DICE_REVEAL_MAX_MS).toBeLessThanOrEqual(5_000)
  })

  it('lets everything go when the module stops listening', async () => {
    announce()
    const store = useDiceRevealStore()
    store.hold('msg-1')

    useListenersStore().reset()
    await nextTick()
    expect(store.isHeld('msg-1')).toBe(false)
  })
})
