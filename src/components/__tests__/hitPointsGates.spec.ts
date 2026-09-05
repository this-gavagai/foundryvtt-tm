// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, computed } from 'vue'
import type { VueWrapper } from '@vue/test-utils'
import { mountComponent, buttonTexts } from './mountComponent'
import HitPoints from '@/components/HitPoints.vue'
import { actorKey } from '@/composables/injectKeys'
import { useTopOverlayZIndex } from '@/composables/useOverlayStack'

// The hit-point modal holds one of each kind of write side by side, and that is
// the whole reason this is worth mounting: typing a number falls back to a
// direct write with no GM (composables/setHitPoints), while the last-damage
// button beside it applies a card's damage through PF2e's IWR pass on the GM's
// client and cannot.
//
// WHICH roll that button is about, and which direction it applies, are decided
// in composables/useLastDamage and tested there. What only a mount can show is
// the consequence of it not being a submit button like its neighbours: a tap
// that fails has to leave the modal on screen, because the failure is reported
// on the button itself.

const canApply = ref(true)
const applyLastDamage = vi.fn(() => Promise.resolve())

vi.mock('@/composables/useHapticFeedback', () => ({
  triggerLightHapticFeedback: vi.fn(),
  triggerDismissHapticFeedback: vi.fn()
}))
vi.mock('@/composables/useLastDamage', () => ({
  useLastDamage: () => ({
    offer: computed(() => ({ messageId: 'msg-1', total: 7, isHealing: false })),
    canApply: computed(() => canApply.value),
    label: computed(() => '-7'),
    color: computed(() => 'red'),
    applyLastDamage
  })
}))

const character = {
  _actor: ref({ _id: 'seelah' }),
  hp: {
    current: computed(() => 20),
    max: computed(() => 42),
    temp: computed(() => 0),
    modifiers: computed(() => []),
    set: vi.fn(() => Promise.resolve())
  }
}

// The modal's panel is only in the DOM once opened, and it teleports out of the
// component tree — so open it the way a player does and read the document.
let wrapper: VueWrapper | undefined

async function openHpModal() {
  wrapper = mountComponent(HitPoints, {
    global: { provide: { [actorKey as symbol]: character } }
  })
  await wrapper.find('[role="button"]').trigger('click')
  await wrapper.vm.$nextTick()
  return wrapper
}

function lastDamageButton(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '-7') as
    HTMLButtonElement | undefined
}

// Asked of the overlay stack, NOT of the DOM: closing runs a 200ms leave
// transition whose `transitionend` jsdom never fires, so a closed modal's panel
// is still in the document here. The stack is what `close()` pops synchronously,
// and it is 0 exactly when nothing is on screen.
const modalIsOpen = () => useTopOverlayZIndex().value > 0

beforeEach(() => {
  canApply.value = true
  applyLastDamage.mockReset()
  applyLastDamage.mockResolvedValue(undefined)
})

// The overlay stack is module state shared by every modal in the app, so a
// wrapper left mounted would keep its layer on it and the next test would open
// onto a non-empty stack.
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

describe('the last-damage button', () => {
  it('is offered when the composable says it can be applied', async () => {
    await openHpModal()
    expect(buttonTexts()).toContain('-7')
  })

  // applyDamage is an RPC with no direct-write half, so when the composable
  // withholds the offer (no GM listening, nothing recent to apply, or a roll
  // this client made itself) there must be no button to swallow the tap.
  it('is withheld when the composable withholds the offer', async () => {
    canApply.value = false
    await openHpModal()
    expect(buttonTexts()).not.toContain('-7')
  })

  it('closes the modal once the damage has landed', async () => {
    const w = await openHpModal()
    expect(modalIsOpen()).toBe(true)
    lastDamageButton()!.click()
    await w.vm.$nextTick()
    await w.vm.$nextTick()
    expect(applyLastDamage).toHaveBeenCalled()
    expect(modalIsOpen()).toBe(false)
  })

  // The reason this one is not a submit button. Closing over a failed tap is
  // exactly the bug the gate was added for: nothing happened and nothing said so.
  it('stays open when the damage does not land', async () => {
    applyLastDamage.mockRejectedValue(new Error('no listener'))
    const w = await openHpModal()
    lastDamageButton()!.click()
    await w.vm.$nextTick()
    await w.vm.$nextTick()
    expect(modalIsOpen()).toBe(true)
  })

  // The point of the pairing: the field beside it still works, because
  // setHitPoints falls back to a direct write.
  it('leaves the hit-point field and its Update button in place', async () => {
    canApply.value = false
    await openHpModal()
    expect(document.querySelector('input[name="hp"]')).not.toBeNull()
    expect(buttonTexts().join(' ')).toMatch(/Update/i)
  })
})
