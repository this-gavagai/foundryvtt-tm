import { describe, it, expect, vi, beforeEach } from 'vitest'

// Damage-modifier overrides are ambient state: while a handler runs, its
// { slug: enabled } map sits on top of a stack that PF2e's patched Modifier
// prototype reads on every `test()` / `applyAdjustments()`. That works because
// the dispatch chain runs one handler at a time — until it doesn't.
//
// The chain gives up on a handler that never settles (HANDLER_QUEUE_TIMEOUT_MS
// in listener.ts) and starts the next request while the hung one is still
// running. From that point the stack no longer unwinds LIFO, which is what these
// pin: a frame must come off by IDENTITY, and the queue must be able to tear the
// whole stack down from outside. backgroundRoll.js and chatOrigin.ts already
// learned both lessons; this is the third mechanism with the same shape.

vi.mock('@/utils/utilities', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() }
}))

import {
  withDamageModifierOverrides,
  abandonDamageModifierOverrides
} from '@/foundry/handlers/checks/modifierOverrides'

// The two fields applyDamageOverride writes, plus the prototype methods the
// module patches. `test()` is the hook that reads the top-of-stack overrides.
class FakeModifier {
  enabled = true
  ignored = false
  constructor(readonly slug: string) {}
  test(_options: string[] | Set<string>) {}
  applyAdjustments(_args: { rollOptions: Iterable<string> }) {}
}

// What a modifier ends up as after a roll that ran under whatever overrides were
// on the stack at the time.
function rolled(slug: string): FakeModifier {
  const modifier = new FakeModifier(slug)
  modifier.test([])
  return modifier
}

beforeEach(() => {
  abandonDamageModifierOverrides()
  ;(globalThis as { game?: unknown }).game = { pf2e: { Modifier: FakeModifier } }
})

describe('a frame comes off by identity, not by position', () => {
  it('leaves the running request its own overrides when a hung one settles late', async () => {
    let releaseHung: (() => void) | undefined
    const hung = withDamageModifierOverrides(
      { 'hung-toggle': false },
      () => new Promise<void>((r) => (releaseHung = r))
    )

    // The queue has moved on: the next request pushes its own frame while the
    // hung one is still on the stack.
    let releaseLive: (() => void) | undefined
    const live = withDamageModifierOverrides(
      { 'live-toggle': false },
      () => new Promise<void>((r) => (releaseLive = r))
    )

    expect(rolled('live-toggle').enabled).toBe(false)

    // The hung handler finally settles. A positional pop here would discard the
    // LIVE request's frame and leave the hung one's on top — so the live roll
    // would stop honouring its own toggle and start honouring a stranger's.
    releaseHung!()
    await hung

    expect(rolled('live-toggle').enabled).toBe(false)
    expect(rolled('hung-toggle').enabled).toBe(true)

    releaseLive!()
    await live
  })

  it('stops applying anything once the last frame is gone', async () => {
    await withDamageModifierOverrides({ someone: false }, async () => undefined)
    expect(rolled('someone').enabled).toBe(true)
  })
})

describe('abandoning a hung handler', () => {
  it('drops every override in flight', async () => {
    let release: (() => void) | undefined
    const hung = withDamageModifierOverrides(
      { 'hung-toggle': false },
      () => new Promise<void>((r) => (release = r))
    )

    expect(rolled('hung-toggle').enabled).toBe(false)
    expect(abandonDamageModifierOverrides()).toBe(1)

    // Without this, the abandoned frame is top-of-stack again the moment the
    // queue drains — so one player's modifier toggles land on every later damage
    // roll on this client, the GM's own included.
    expect(rolled('hung-toggle').enabled).toBe(true)

    release!()
    await hung
    expect(rolled('hung-toggle').enabled).toBe(true)
  })

  it('counts capture frames too, so the prototype patches can come off', async () => {
    let release: (() => void) | undefined
    const hung = withDamageModifierOverrides(
      undefined,
      () => new Promise<void>((r) => (release = r)),
      new Set()
    )

    expect(abandonDamageModifierOverrides()).toBe(1)

    release!()
    await hung
  })

  it('does nothing when no handler is running', () => {
    expect(abandonDamageModifierOverrides()).toBe(0)
  })
})
