import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  chatMessageClass,
  configPF2E,
  diceRollClasses,
  drawnSceneId,
  getChatLog,
  getFilePicker,
  getGame,
  hooks,
  itemClass,
  localize,
  notifications,
  resolveUuid,
  resolveUuidSync,
  settingsApi
} from '@/foundry/globals'

// Most accessors here are a single property read and are covered wherever they
// are used. What these tests pin is the part with actual branching: the two
// globals Foundry RELOCATED (FilePicker and ChatLog moved into namespaces in v13,
// leaving the bare names as deprecated aliases) and the absence-tolerant reads.
//
// Also pinned: everything resolves at CALL time. Foundry injects these while it
// boots, long after this module is evaluated, and tests install their own per
// case — an accessor that captured a global at import time would read undefined
// forever.

const g = globalThis as Record<string, unknown>
const KEYS = [
  'game',
  'ui',
  'canvas',
  'CONFIG',
  'Hooks',
  'ChatMessage',
  'foundry',
  'fromUuid',
  'fromUuidSync',
  'FilePicker',
  'ChatLog'
] as const

beforeEach(() => KEYS.forEach((k) => delete g[k]))
afterEach(() => KEYS.forEach((k) => delete g[k]))

describe('call-time resolution', () => {
  // The property is read on every call, so a global installed after this module
  // was imported is still found — and a later replacement is seen too.
  it('reads the global on each call, not at import', () => {
    g.game = { i18n: { localize: () => 'first' } }
    expect(localize('KEY')).toBe('first')
    g.game = { i18n: { localize: () => 'second' } }
    expect(localize('KEY')).toBe('second')
  })
})

describe('getGame / settingsApi', () => {
  it('returns the live game and its settings API', () => {
    const settings = { register: vi.fn(), get: vi.fn(), set: vi.fn() }
    g.game = { settings }
    expect(getGame()).toBe(g.game)
    expect(settingsApi()).toBe(settings)
  })

  // Reads can run before registration (a capability probe on a world that never
  // saved the setting). Callers wrap those in try/catch and fall back to a
  // default, which only works if reaching through here still throws.
  it('throws when game is not up yet, as the bare global did', () => {
    expect(() => settingsApi()).toThrow()
  })
})

describe('resolveUuid', () => {
  it('prefers the namespaced foundry.utils.fromUuid', async () => {
    const namespaced = vi.fn(async () => ({ id: 'from-namespace' }))
    const bare = vi.fn(async () => ({ id: 'from-global' }))
    g.foundry = { utils: { fromUuid: namespaced } }
    g.fromUuid = bare
    await expect(resolveUuid('Compendium.pf2e.x.Item.y')).resolves.toEqual({ id: 'from-namespace' })
    expect(bare).not.toHaveBeenCalled()
  })

  it('falls back to the bare global', async () => {
    g.fromUuid = vi.fn(async () => ({ id: 'from-global' }))
    await expect(resolveUuid('Item.abc')).resolves.toEqual({ id: 'from-global' })
  })

  it('passes the uuid through unchanged', async () => {
    const resolve = vi.fn(async () => null)
    g.fromUuid = resolve
    await resolveUuid('Compendium.pf2e.feat-effects.Item.pLurcSPQb2gjAzoP')
    expect(resolve).toHaveBeenCalledWith('Compendium.pf2e.feat-effects.Item.pLurcSPQb2gjAzoP')
  })

  // A missing resolver is a broken client, not a missing document — the two must
  // not look the same, or a handler would report "not found" for either.
  it('throws rather than resolving null when fromUuid is unavailable', async () => {
    await expect(resolveUuid('Item.abc')).rejects.toThrow('fromUuid is unavailable')
  })

  it('resolveUuidSync uses the sync global and has the same fallback', () => {
    g.foundry = { utils: { fromUuidSync: () => ({ id: 'ns' }) } }
    g.fromUuidSync = () => ({ id: 'bare' })
    expect(resolveUuidSync('Item.a')).toEqual({ id: 'ns' })
    delete g.foundry
    expect(resolveUuidSync('Item.a')).toEqual({ id: 'bare' })
    delete g.fromUuidSync
    expect(() => resolveUuidSync('Item.a')).toThrow('fromUuidSync is unavailable')
  })
})

// FilePicker and ChatLog are the two globals Foundry actually moved: v13 put them
// under foundry.applications.* and left the bare names as deprecated aliases, so
// both spellings have to work.
describe('relocated globals', () => {
  const picker = { upload: vi.fn(), createDirectory: vi.fn(), browse: vi.fn() }

  it('finds FilePicker in its v13 namespace', () => {
    g.foundry = { applications: { apps: { FilePicker: picker } } }
    expect(getFilePicker()).toBe(picker)
  })

  it('finds FilePicker as the bare pre-v13 global', () => {
    g.FilePicker = picker
    expect(getFilePicker()).toBe(picker)
  })

  it('throws a named error when FilePicker is nowhere', () => {
    expect(() => getFilePicker()).toThrow('FilePicker is unavailable')
  })

  it('finds ChatLog in either home', () => {
    const chatLog = { parse: vi.fn() }
    g.foundry = { applications: { sidebar: { tabs: { ChatLog: chatLog } } } }
    expect(getChatLog()).toBe(chatLog)
    delete g.foundry
    g.ChatLog = chatLog
    expect(getChatLog()).toBe(chatLog)
  })

  // Unlike FilePicker, a missing ChatLog is survivable: the chat handler posts
  // the text unparsed rather than failing the send.
  it('reports ChatLog as absent instead of throwing', () => {
    expect(getChatLog()).toBeUndefined()
  })
})

describe('absence-tolerant reads', () => {
  // ui.notifications does not exist until the UI renders, and a compatibility
  // notice at ready must never be the reason startup fails.
  it('notifications is undefined before the UI exists', () => {
    expect(notifications()).toBeUndefined()
    g.ui = {}
    expect(notifications()).toBeUndefined()
    const api = { warn: vi.fn() }
    g.ui = { notifications: api }
    expect(notifications()).toBe(api)
  })

  // A GM sitting on the world setup screen has no scene drawn; sceneId is
  // nullable on the wire for exactly this case.
  it('drawnSceneId is null with no canvas or no scene', () => {
    expect(drawnSceneId()).toBeNull()
    g.canvas = {}
    expect(drawnSceneId()).toBeNull()
    g.canvas = { scene: null }
    expect(drawnSceneId()).toBeNull()
    g.canvas = { scene: { id: 'scene-a' } }
    expect(drawnSceneId()).toBe('scene-a')
  })

  // Read before PF2e registers its roll classes, so callers can fall back to a
  // plain Roll rather than crashing.
  it('diceRollClasses is empty before CONFIG.Dice exists', () => {
    expect(diceRollClasses()).toEqual([])
    g.CONFIG = { Dice: {} }
    expect(diceRollClasses()).toEqual([])
    g.CONFIG = { Dice: { rolls: [{ name: 'DamageRoll' }] } }
    expect(diceRollClasses()).toEqual([{ name: 'DamageRoll' }])
  })
})

describe('straight reads', () => {
  it('hooks, chatMessageClass, itemClass and configPF2E return the globals', () => {
    const Hooks = { on: vi.fn(), off: vi.fn(), once: vi.fn() }
    const ChatMessage = { create: vi.fn(), getSpeaker: vi.fn(), getWhisperRecipients: vi.fn() }
    class FakeItem {
      toChat() {
        return Promise.resolve()
      }
    }
    g.Hooks = Hooks
    g.ChatMessage = ChatMessage
    g.CONFIG = { Item: { documentClass: FakeItem }, PF2E: { languages: { common: 'Common' } } }
    expect(hooks()).toBe(Hooks)
    expect(chatMessageClass()).toBe(ChatMessage)
    expect(itemClass()).toBe(FakeItem)
    expect(configPF2E()).toEqual({ languages: { common: 'Common' } })
  })

  it('localize delegates to the world i18n', () => {
    const localizeMock = vi.fn((k: string) => (k === 'KNOWN' ? 'Known' : k))
    g.game = { i18n: { localize: localizeMock } }
    expect(localize('KNOWN')).toBe('Known')
    // An untranslated key comes back unchanged, which is what lets callers fall
    // back to a raw slug.
    expect(localize('PF2E.Nope')).toBe('PF2E.Nope')
  })
})
