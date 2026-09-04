// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { REACTION_EMOJI } from '@/utils/chatReactions'

// The context-menu entries are the module's only path to a message's FIRST
// reaction, and they reach Foundry through a hook payload we mutate in place —
// so what's asserted here is the contract with core: the entry shape it reads,
// and that a second hook firing can't double the palette.
//
// A reaction is written to the reactor's OWN user document, so the callback's
// target is `game.user.setFlag` — stubbed below so an entry can be invoked
// without a live world.
// The world switch for the feature (featureToggles.ts), read off the `game`
// stubs below. On except where a case turns it off.
let reactionsOn = true

const setFlagMock = vi.fn(async () => ({}))

const { registerContextEntries, setupReactionContextMenu } =
  await import('@/foundry/reactionDisplay')

type Entry = {
  name: string
  label?: string
  group?: string
  visible?: (target: unknown) => boolean
  condition?: (target: unknown) => boolean
  callback: (target: unknown) => unknown
}

function collect(existing: unknown[] = []): Entry[] {
  registerContextEntries(existing)
  return existing as Entry[]
}

beforeEach(() => {
  vi.clearAllMocks()
  reactionsOn = true
  ;(globalThis as Record<string, unknown>).game = {
    user: { _id: 'gm-1', isGM: true, flags: {}, setFlag: setFlagMock },
    users: { get: () => ({ name: 'GM' }), activeGM: { id: 'gm-1' } },
    socket: { emit: vi.fn() },
    settings: { get: () => reactionsOn }
  }
})

describe('registerContextEntries', () => {
  it('appends one entry per palette emoji, in its own group', () => {
    const entries = collect()
    expect(entries.map((e) => e.name)).toEqual([...REACTION_EMOJI])
    // The group id is what the one-row stylesheet hooks onto, and what keeps the
    // rule off core's and other modules' entries.
    expect(entries.every((e) => e.group === 'tm-reactions')).toBe(true)
  })

  it('sets BOTH label and name', () => {
    // Same version span as visible/condition: v14 deprecated `name` in favour of
    // `label` and warns when it sees `name` alone; v13 reads only `name`.
    for (const entry of collect()) {
      expect(entry.label).toBe(entry.name)
      expect(entry.label).toBeTruthy()
    }
  })

  it('preserves entries the core (or another module) already added', () => {
    const entries = collect([{ name: 'Delete' }])
    expect(entries[0].name).toBe('Delete')
    expect(entries).toHaveLength(REACTION_EMOJI.length + 1)
  })

  it('sets BOTH visible and condition', () => {
    // v14 prefers `visible` and logs a deprecation when it sees `condition`
    // alone; v13 only reads `condition`. Dropping either regresses one of them.
    for (const entry of collect()) {
      expect(typeof entry.visible).toBe('function')
      expect(typeof entry.condition).toBe('function')
    }
  })

  it('does not double up if a second hook fires for the same menu', () => {
    const options: unknown[] = []
    registerContextEntries(options)
    registerContextEntries(options)
    expect(options).toHaveLength(REACTION_EMOJI.length)
  })

  it('ignores a payload that is not an entry array', () => {
    expect(() => registerContextEntries(undefined)).not.toThrow()
    expect(() => registerContextEntries({})).not.toThrow()
  })

  it('still offers the entries to a player with no GM online', () => {
    const entries = collect()
    ;(globalThis as Record<string, unknown>).game = {
      user: { _id: 'u1', isGM: false },
      users: { get: () => undefined, activeGM: null },
      settings: { get: () => reactionsOn }
    }
    // A reaction goes to the player's own user document, so nothing is waiting
    // on a GM any more. This asserted `false` while it was an RPC.
    expect(entries[0].visible?.(document.createElement('div'))).toBe(true)
  })

  it('shows the entries for a player when a GM is online', () => {
    const entries = collect()
    ;(globalThis as Record<string, unknown>).game = {
      user: { _id: 'u1', isGM: false },
      users: { get: () => undefined, activeGM: { id: 'gm-1' } },
      settings: { get: () => reactionsOn }
    }
    expect(entries[0].visible?.(document.createElement('div'))).toBe(true)
  })

  it('hides the entries when the world has reactions switched off', () => {
    // The entry array is built once at `init`, long before settings exist, so
    // the switch can only be honoured by the visibility check core re-runs on
    // every open. A GM sees no entries either: off means off at the table's own
    // screens, not just on the tablets.
    const entries = collect()
    reactionsOn = false

    expect(entries[0].visible?.(document.createElement('div'))).toBe(false)
    expect(entries[0].condition?.(document.createElement('div'))).toBe(false)
  })

  it('resolves the message id from the right-clicked element', async () => {
    const target = document.createElement('div')
    target.dataset.messageId = 'msg-1'
    collect()[0].callback(target)
    await vi.waitFor(() => expect(setFlagMock).toHaveBeenCalled())
    // Written to this user's own document, keyed by the message rather than
    // carrying a userId — the author IS the document it sits on. Whole-flag
    // here, unlike the app's per-row patch: a Foundry client can only set a flag
    // to a value, and the stored shape is the same either way.
    expect(setFlagMock).toHaveBeenCalledWith('tablemate', 'reactions', {
      'msg-1': { e: [REACTION_EMOJI[0]], t: expect.any(Number) }
    })
  })

  it('resolves the id from an inner node, not just the message root', async () => {
    const message = document.createElement('div')
    message.dataset.messageId = 'msg-1'
    const inner = document.createElement('span')
    message.appendChild(inner)
    // Foundry hands over the matched .message element, but a core that passed an
    // inner node must still land on the right message rather than silently no-op.
    collect()[0].callback(inner)
    await vi.waitFor(() => expect(setFlagMock).toHaveBeenCalledTimes(1))
  })

  it('no-ops on a target with no message id rather than throwing', () => {
    expect(() => collect()[0].callback(document.createElement('div'))).not.toThrow()
    expect(setFlagMock).not.toHaveBeenCalled()
  })
})

describe('setupReactionContextMenu', () => {
  it('injects the one-row stylesheet exactly once, scoped to our group', () => {
    // Hooks.on is called during setup; a stub is enough since only the style
    // injection is under test here.
    ;(globalThis as Record<string, unknown>).Hooks = { on: vi.fn() }
    setupReactionContextMenu()
    setupReactionContextMenu()

    const styles = document.querySelectorAll('#tm-reaction-menu-style')
    expect(styles).toHaveLength(1)
    const css = styles[0].textContent ?? ''
    expect(css).toContain("[data-group-id='tm-reactions']")
    expect(css).toContain('display: flex')
    // An unscoped rule would reflow every context menu in Foundry.
    expect(css).not.toMatch(/^\s*li\.context-item/m)
  })
})
