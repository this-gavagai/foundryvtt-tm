import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TM } from '@/api/protocol'
import type { ActorPF2e } from '@7h3laughingman/pf2e-types'
import type { RollCheckArgs } from '@/types/api-types'
import { handleRecovery } from '@/foundry/handlers/checks/recovery'
import type { CheckRollContext } from '@/foundry/handlers/checks/types'

// The recovery check delegates wholesale to PF2e's CreaturePF2e#rollRecovery,
// which owns the DC (recoveryDC + dying value, so Toughness is already in the
// prepared attribute) and the four outcome notes. It applies no consequences,
// because base PF2e applies none either — a tablet roll has to leave the world
// in the same state a roll from the desktop sheet would, so whatever a table
// already uses to apply results stays the only thing doing it.
//
// What this handler adds is the refusal: the app can only offer the button from
// a Dying condition it believes is present, and a request that arrives when it
// isn't must fail rather than ack a roll nobody made.

const rollRecovery = vi.fn(async () => ({ total: 14, degreeOfSuccess: 2 }))
const updateConditionValue = vi.fn(async () => {})
const increaseCondition = vi.fn(async () => null)
const toggleDefeated = vi.fn(async () => {})
const toggleStatusEffect = vi.fn(async () => {})

function makeActor(opts: { type?: string; dying?: number } = {}) {
  const type = opts.type ?? 'character'
  return {
    name: 'Seelah',
    isOfType: (...types: string[]) =>
      types.includes(type) || (types.includes('creature') && type !== 'hazard'),
    attributes: {
      dying: { value: opts.dying ?? 2, max: 4, recoveryDC: 10 },
      wounded: { value: 0, max: 3 }
    },
    conditions: { dying: { id: 'dying-item-id' } },
    combatant: { toggleDefeated },
    rollRecovery,
    increaseCondition,
    toggleStatusEffect
  } as unknown as ActorPF2e
}

const event = { type: 'click' } as PointerEvent

function context(actor: ActorPF2e): CheckRollContext {
  return {
    source: { pf2e: { ConditionManager: { updateConditionValue } } },
    actor,
    args: { action: TM.ROLL_CHECK, checkType: 'recovery' } as unknown as RollCheckArgs,
    params: { event } as unknown as CheckRollContext['params']
  } as unknown as CheckRollContext
}

beforeEach(() => vi.clearAllMocks())

describe('handleRecovery', () => {
  it('hands the roll to PF2e rather than assembling an equivalent check', async () => {
    await handleRecovery(context(makeActor()))
    expect(rollRecovery).toHaveBeenCalledTimes(1)
  })

  it('passes the request event through, so roll params resolve as PF2e expects', async () => {
    await handleRecovery(context(makeActor()))
    expect(rollRecovery).toHaveBeenCalledWith(event)
  })

  it('applies no consequences of its own, exactly as base PF2e applies none', async () => {
    // A success from dying 1 would take the character out of dying and grant
    // Wounded, if anything here were applying results. Nothing is: the card says
    // what happened, and the table's own automation — or the +/- buttons in the
    // condition modal — moves the value.
    await handleRecovery(context(makeActor({ dying: 1 })))
    expect(updateConditionValue).not.toHaveBeenCalled()
    expect(increaseCondition).not.toHaveBeenCalled()
    expect(toggleDefeated).not.toHaveBeenCalled()
    expect(toggleStatusEffect).not.toHaveBeenCalled()
  })

  // Thrown synchronously, like every other check handler's refusal
  // (requireStatistic in checks/statistic.ts): the orchestrator's central catch
  // turns it into an error ack either way.
  it('refuses when the actor is not dying', () => {
    // PF2e's own method answers null here; acking that as a successful roll
    // would open a result modal for a roll that never happened.
    expect(() => handleRecovery(context(makeActor({ dying: 0 })))).toThrow('is not dying')
    expect(rollRecovery).not.toHaveBeenCalled()
  })

  it('refuses an actor with no dying track at all', () => {
    expect(() => handleRecovery(context(makeActor({ type: 'hazard' })))).toThrow(
      'cannot make a recovery check'
    )
    expect(rollRecovery).not.toHaveBeenCalled()
  })
})
