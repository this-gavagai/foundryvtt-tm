// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountComponent } from './mountComponent'
import RestForTheNight from '@/components/RestForTheNight.vue'
import { characterKey } from '@/composables/injectKeys'
import { useListenersStore } from '@/stores/listenersOnline'
import en from '@/locales/en.json'

// Three rules that exist only in this component's template and handlers, and
// every one of them is the difference between "ends the party's day" and
// "doesn't":
//
//   * the button is disabled with no GM, because the rest is an RPC and would
//     otherwise sit out the full ack budget and report nothing;
//   * a tap CONFIRMS before it rests, because PF2e's own confirmation is
//     skipped on the Foundry side (it would open on the GM's screen), so this
//     dialog is the only thing standing between a mis-scroll and an
//     irreversible write to the character;
//   * cancelling rests nothing — and still settles the button, which owns the
//     pending spinner and would otherwise spin for good.

vi.mock('@/composables/useHapticFeedback', () => ({
  triggerLightHapticFeedback: vi.fn(),
  triggerDismissHapticFeedback: vi.fn()
}))

const doRestForTheNight = vi.fn(() => Promise.resolve(null))
const character = { doRestForTheNight }

const REST = en.rest.button
const CANCEL = en.common.cancel

function mountRest() {
  return mountComponent(RestForTheNight, {
    global: { provide: { [characterKey as symbol]: character } }
  })
}

// The dialog teleports out of the component tree and into #modals, so its
// buttons are read off the document — where the section's own button, which is
// not teleported, deliberately does not appear.
function documentButton(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as
    HTMLButtonElement | undefined
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('the Rest for the Night button', () => {
  it('is disabled, and says why, with no GM listening', async () => {
    const w = mountRest()
    expect(w.find('button').text()).toBe(REST)
    expect(w.find('button').attributes('disabled')).toBeDefined()
    expect(w.text()).toContain(en.rest.needsGm)
  })

  it('is enabled once a GM answers the heartbeat', async () => {
    const w = mountRest()
    useListenersStore().addListener('gm-client')
    await w.vm.$nextTick()
    expect(w.find('button').attributes('disabled')).toBeUndefined()
    expect(w.text()).not.toContain(en.rest.needsGm)
  })

  it('asks before it rests', async () => {
    const w = mountRest()
    useListenersStore().addListener('gm-client')
    await w.vm.$nextTick()

    await w.find('button').trigger('click')
    await w.vm.$nextTick()

    // The tap opened the dialog and rested nothing yet.
    expect(doRestForTheNight).not.toHaveBeenCalled()
    expect(documentButton(CANCEL)).toBeDefined()
  })

  it('rests once the player confirms', async () => {
    const w = mountRest()
    useListenersStore().addListener('gm-client')
    await w.vm.$nextTick()
    await w.find('button').trigger('click')
    await w.vm.$nextTick()

    // The confirm button carries the same label as the one that opened it, so
    // take the one in the teleported dialog rather than the section's.
    documentButton(REST)?.click()
    await w.vm.$nextTick()

    expect(doRestForTheNight).toHaveBeenCalledTimes(1)
  })

  it('rests nothing when the player cancels', async () => {
    const w = mountRest()
    useListenersStore().addListener('gm-client')
    await w.vm.$nextTick()
    await w.find('button').trigger('click')
    await w.vm.$nextTick()

    documentButton(CANCEL)?.click()
    await w.vm.$nextTick()

    expect(doRestForTheNight).not.toHaveBeenCalled()
  })
})
