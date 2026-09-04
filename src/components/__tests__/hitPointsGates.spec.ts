// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { ref, computed } from 'vue'
import { mountComponent, buttonTexts } from './mountComponent'
import HitPoints from '@/components/HitPoints.vue'
import { actorKey } from '@/composables/injectKeys'
import { useListenersStore } from '@/stores/listenersOnline'

// The hit-point modal holds one of each kind of write, side by side, and that
// is the whole reason this is worth mounting: typing a number falls back to a
// direct write with no GM (composables/setHitPoints), while the -N/+N buttons
// beside it apply a card's damage through PF2e's IWR pass on the GM's client and
// cannot. Ungated, those two buttons were fire-and-forget with the modal closing
// behind them: a tap did nothing and said nothing, forever.

vi.mock('@/api/actionRpc', () => ({ applyDamage: vi.fn() }))
vi.mock('@/composables/useHapticFeedback', () => ({ triggerLightHapticFeedback: vi.fn() }))
vi.mock('@/composables/useLastDamage', () => ({
  useLastDamage: () => ({
    lastDamageAmount: computed(() => 7),
    lastDamageMessageId: computed(() => 'msg-1')
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
async function openHpModal() {
  const w = mountComponent(HitPoints, {
    global: { provide: { [actorKey as symbol]: character } }
  })
  await w.find('[role="button"]').trigger('click')
  await w.vm.$nextTick()
  return w
}

describe('the last-damage buttons', () => {
  it('are offered when a GM is listening', async () => {
    // The store is created by the mount, so a listener can only be added after
    // it — which is also the real sequence: the heartbeat answers while the
    // sheet is already up, and the buttons appear.
    const w = await openHpModal()
    useListenersStore().addListener('gm-client')
    await w.vm.$nextTick()
    expect(buttonTexts()).toContain('-7')
    expect(buttonTexts()).toContain('+7')
  })

  // applyDamage is an RPC with no direct-write half, so with no GM the tap can
  // only be swallowed. Hidden rather than offered.
  it('are withheld with no GM listening', async () => {
    await openHpModal()
    expect(buttonTexts()).not.toContain('-7')
    expect(buttonTexts()).not.toContain('+7')
  })

  // The point of the pairing: the field beside them still works, because
  // setHitPoints falls back to a direct write.
  it('leave the hit-point field and its Update button in place', async () => {
    await openHpModal()
    expect(document.querySelector('input[name="hp"]')).not.toBeNull()
    expect(buttonTexts().join(' ')).toMatch(/Update/i)
  })
})
