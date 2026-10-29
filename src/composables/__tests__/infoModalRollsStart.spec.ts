// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useInfoModalRolls } from '@/composables/useInfoModalRolls'
import { useListenersStore } from '@/stores/listenersOnline'
import { useVersionCompatStore } from '@/stores/versionCompat'
import { CAPABILITY_DICE_REVEAL, PROTOCOL_VERSION } from '@/api/protocol'
import type { Roll } from '@/types/roll-types'

vi.mock('@/composables/useHapticFeedback', () => ({ triggerRollHapticFeedback: vi.fn() }))

// Where Dice So Nice is throwing the dice on the table's screen, the result
// panel opens the moment a roll is sent rather than when its answer arrives —
// except for a roll the player made with physical dice, whose answer is not
// held back.

function holdingWorld() {
  useListenersStore().addListener('gm-1')
  useVersionCompatStore().reportModule(PROTOCOL_VERSION, '1.0.0', [CAPABILITY_DICE_REVEAL])
}

function setup(execute: Roll['execute']) {
  const order: string[] = []
  const roll: Roll = {
    key: 'check',
    label: 'Athletics +7',
    dice: ['d20'],
    execute: (faces) => {
      order.push('execute')
      return execute(faces)
    }
  }
  const onRollStarted = vi.fn(() => order.push('started'))
  const onRollResolved = vi.fn()
  const onRollError = vi.fn()
  const rolls = useInfoModalRolls({
    rolls: ref([roll]),
    isOpen: ref(true),
    onRollStarted,
    onRollResolved,
    onRollError
  })
  return { roll, rolls, order, onRollStarted, onRollResolved, onRollError }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('the result panel opening before the result', () => {
  // The caller closes its modal when told, which resets state execute() reads.
  it('is announced once the roll is on its way', async () => {
    holdingWorld()
    const { roll, rolls, order, onRollStarted, onRollResolved } = setup(async () => null)

    await rolls.executeRoll(roll)

    expect(onRollStarted).toHaveBeenCalledExactlyOnceWith(roll)
    expect(order).toEqual(['execute', 'started'])
    expect(onRollResolved).toHaveBeenCalledOnce()
  })

  it('is not announced for a roll made with physical dice', async () => {
    holdingWorld()
    const { roll, rolls, onRollStarted } = setup(async () => null)

    await rolls.executeRoll(roll, [17])

    expect(onRollStarted).not.toHaveBeenCalled()
  })

  it('is not announced where nothing holds the result back', async () => {
    const { roll, rolls, onRollStarted } = setup(async () => null)

    await rolls.executeRoll(roll)

    expect(onRollStarted).not.toHaveBeenCalled()
  })

  it('is followed by the failure when the roll does not go through', async () => {
    holdingWorld()
    const { roll, rolls, onRollStarted, onRollError } = setup(async () => {
      throw new Error('handler exploded')
    })

    await rolls.executeRoll(roll)

    expect(onRollStarted).toHaveBeenCalledOnce()
    expect(onRollError).toHaveBeenCalledOnce()
  })
})
