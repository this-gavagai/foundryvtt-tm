import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { checkSystemCompat } from '@/foundry/systemCompat'

// checkSystemCompat is the ready-time guard against PF2e/Foundry drift: it
// compares versions against the tested range and probes the internals each
// feature hangs off, warning the GM once. These tests pin that a healthy
// environment stays silent and that version drift / missing internals are
// named in the notice.
//
// The tested ranges come from module.json, read back off the manifest Foundry
// parsed — so `game.modules` is part of the fixture, carrying the same shape a
// live manifest has (a Set of relationships, compatibility as strings).

const warn = vi.fn()

// The compatibility shapes as Foundry parses them from a manifest. Declared here
// so a test can override one field without the fixture's inferred literal type
// refusing the others.
type Compat = { minimum?: string; verified?: string; maximum?: string }
type Manifest = {
  compatibility?: Compat
  relationships?: { systems?: Iterable<{ id?: string; compatibility?: Compat }> }
}

// Mirrors module.json: `compatibility` bounds Foundry, the pf2e entry in
// `relationships.systems` bounds the system.
const manifest = (): Manifest => ({
  compatibility: { minimum: '13', verified: '14' },
  relationships: {
    systems: new Set([{ id: 'pf2e', compatibility: { minimum: '7.0.0', verified: '8.3.0' } }])
  }
})

function healthyGlobals() {
  return {
    game: {
      user: { isGM: true },
      system: { version: '8.3.0' },
      release: { generation: 14 },
      // The parsed manifest, read back for the tested ranges.
      modules: {
        get: (id: string): Manifest | undefined => (id === 'tablemate' ? manifest() : undefined)
      },
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

  it('warns when Foundry is outside the generations the manifest declares', () => {
    const globals = healthyGlobals()
    globals.game.release.generation = 15
    install(globals)
    checkSystemCompat()
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0][0]).toContain('Foundry v15 is outside the tested range (v13–v14)')
  })

  // The range is read from the manifest, so widening module.json widens the
  // check — no second copy in the source to bump in lockstep.
  it('follows the manifest when it declares a wider range', () => {
    const globals = healthyGlobals()
    globals.game.system.version = '9.1.0'
    globals.game.release.generation = 15
    globals.game.modules.get = () => ({
      compatibility: { minimum: '13', verified: '15' },
      relationships: {
        systems: new Set([{ id: 'pf2e', compatibility: { minimum: '7.0.0', verified: '9.0.0' } }])
      }
    })
    install(globals)
    checkSystemCompat()
    expect(warn).not.toHaveBeenCalled()
  })

  it('prefers an explicit maximum when the manifest declares no verified build', () => {
    const globals = healthyGlobals()
    globals.game.release.generation = 15
    globals.game.modules.get = () => ({
      compatibility: { minimum: '13', maximum: '15' },
      relationships: { systems: new Set([]) }
    })
    install(globals)
    checkSystemCompat()
    expect(warn).not.toHaveBeenCalled()
  })

  // Silence beats a guess: with no declared range there is nothing to compare
  // against, and inventing one would report drift that may not exist.
  it('skips the version check when the manifest declares no range', () => {
    const globals = healthyGlobals()
    globals.game.system.version = '99.0.0'
    globals.game.release.generation = 99
    globals.game.modules.get = () => undefined
    install(globals)
    checkSystemCompat()
    expect(warn).not.toHaveBeenCalled()
  })

  // A manifest with no pf2e relationship still bounds Foundry, and vice versa.
  it('checks each range independently of the other', () => {
    const globals = healthyGlobals()
    globals.game.system.version = '9.1.0'
    globals.game.release.generation = 15
    globals.game.modules.get = () => ({
      compatibility: {},
      relationships: {
        systems: new Set([{ id: 'pf2e', compatibility: { minimum: '7.0.0', verified: '8.3.0' } }])
      }
    })
    install(globals)
    checkSystemCompat()
    expect(warn).toHaveBeenCalledOnce()
    const message = warn.mock.calls[0][0] as string
    expect(message).toContain('PF2e 9.1.0 is outside')
    expect(message).not.toContain('Foundry v15')
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
