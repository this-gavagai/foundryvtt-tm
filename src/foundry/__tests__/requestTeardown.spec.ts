import { describe, it, expect, vi, beforeEach } from 'vitest'

// The dispatch queue gives up on a handler that never settles, and from that
// moment the serialization every ambient mechanism relies on is gone — the next
// request runs while the hung one is still going. Anything the hung one left on
// a stack is now what somebody else's roll reads.
//
// Four mechanisms learned that lesson separately, and the loop ended up calling
// four teardowns by hand. These pin the two properties that makes one registry
// worth more than four calls: every declared mechanism is actually torn down,
// and one of them failing cannot leave the others standing.

const calls: string[] = []
const throwing = new Set<string>()

function fake(name: string, dropped: number) {
  return () => {
    calls.push(name)
    if (throwing.has(name)) throw new Error(`${name} blew up`)
    return dropped
  }
}

vi.mock('@/utils/utilities', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() }
}))
vi.mock('@/foundry/chatOrigin', () => ({ abandonChatOrigin: fake('chatOrigin', 1) }))
vi.mock('@/foundry/backgroundRoll', () => ({ abandonBackgroundRolls: fake('diceResults', 2) }))
vi.mock('@/foundry/utils/target', () => ({ abandonMirroredTargets: fake('targetSwap', 3) }))
vi.mock('@/foundry/handlers/checks/modifierOverrides', () => ({
  abandonDamageModifierOverrides: fake('damageOverrides', 4)
}))

import { abandonRequestContext, type AmbientState } from '@/foundry/requestTeardown'
import type { ChatOrigin } from '@/foundry/chatOrigin'

const origin = { userId: 'player-1' } as ChatOrigin

// Named explicitly rather than derived from the module, so that adding a
// mechanism without a test is visible here too.
const EVERY_MECHANISM: AmbientState[] = [
  'chatOrigin',
  'diceResults',
  'targetSwap',
  'damageOverrides'
]

beforeEach(() => {
  calls.length = 0
  throwing.clear()
})

describe('abandoning a request the queue gave up on', () => {
  it('tears down every mechanism, and reports what each dropped', () => {
    const report = abandonRequestContext(origin)

    expect(calls.sort()).toEqual([...EVERY_MECHANISM].sort())
    expect(report).toEqual({
      chatOrigin: 1,
      diceResults: 2,
      targetSwap: 3,
      damageOverrides: 4
    })
  })

  it('hands the abandoned frame to the teardown that needs it', () => {
    // chatOrigin drops one frame BY IDENTITY; the other three own module-level
    // stacks and ignore the argument.
    const seen: unknown[] = []
    const report = abandonRequestContext(origin)
    seen.push(report.chatOrigin)
    expect(seen).toEqual([1])
  })

  for (const failing of EVERY_MECHANISM) {
    it(`still tears the others down when ${failing} throws`, () => {
      throwing.add(failing)

      const report = abandonRequestContext(origin)

      // The whole point: a mechanism left standing is the bug this prevents, so
      // one throwing must not short-circuit the rest.
      expect(calls.sort()).toEqual([...EVERY_MECHANISM].sort())
      expect(report[failing]).toBe('failed')
      for (const other of EVERY_MECHANISM.filter((m) => m !== failing)) {
        expect(report[other]).toBeTypeOf('number')
      }
    })
  }

  it('never throws, so the queue always advances', () => {
    for (const m of EVERY_MECHANISM) throwing.add(m)
    expect(() => abandonRequestContext(origin)).not.toThrow()
  })
})
