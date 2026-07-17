import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { checkSystemCompat } from '@/foundry/systemCompat'

// checkSystemCompat is the ready-time guard against PF2e/Foundry drift: it
// compares versions against the tested range and probes the internals each
// feature hangs off, warning the GM once. These tests pin that a healthy
// environment stays silent and that version drift / missing internals are
// named in the notice.

const warn = vi.fn()

function healthyGlobals() {
  return {
    game: {
      user: { isGM: true },
      system: { version: '8.3.0' },
      release: { generation: 14 },
      pf2e: {
        Modifier: { prototype: { test: () => {}, applyAdjustments: () => {} } },
        actions: { get: () => {} },
        TextEditor: { _onClickInlineRoll: () => {} },
        Check: { rerollFromMessage: () => {} },
        ElementalBlast: class {}
      }
    },
    ui: { notifications: { warn } },
    CONFIG: { Dice: { rolls: [{ name: 'DamageRoll' }] } }
  }
}

type TestGlobals = ReturnType<typeof healthyGlobals>
const g = globalThis as unknown as Partial<TestGlobals>

function install(globals: TestGlobals) {
  g.game = globals.game
  g.ui = globals.ui
  g.CONFIG = globals.CONFIG
}

beforeEach(() => {
  warn.mockClear()
  // Silence the logger side channel so failing probes don't spam test output.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  delete g.game
  delete g.ui
  delete g.CONFIG
  vi.restoreAllMocks()
})

describe('checkSystemCompat', () => {
  it('stays silent on the tested versions with all internals present', () => {
    install(healthyGlobals())
    checkSystemCompat()
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns the GM when PF2e is outside the tested major range', () => {
    const globals = healthyGlobals()
    globals.game.system.version = '9.1.0'
    install(globals)
    checkSystemCompat()
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0][0]).toContain('PF2e 9.1.0 is outside the tested range')
  })

  it('names the feature whose internals are missing', () => {
    const globals = healthyGlobals()
    ;(globals.game.pf2e.Modifier.prototype as { applyAdjustments?: unknown }).applyAdjustments =
      undefined
    globals.CONFIG.Dice.rolls = []
    install(globals)
    checkSystemCompat()
    expect(warn).toHaveBeenCalledOnce()
    const message = warn.mock.calls[0][0] as string
    expect(message).toContain('per-roll modifier overrides')
    expect(message).toContain('typed damage chat cards')
  })

  it('logs but does not notify when the user is not a GM', () => {
    const globals = healthyGlobals()
    globals.game.user.isGM = false
    globals.game.system.version = '9.1.0'
    install(globals)
    checkSystemCompat()
    expect(warn).not.toHaveBeenCalled()
  })
})
