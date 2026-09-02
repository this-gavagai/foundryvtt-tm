// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useSettingsStore } from '@/stores/settings'

// The turn bar is the one piece of header chrome that grows the header, so it
// is opt-in. "Off by default" is the part worth pinning: a regression here
// doesn't fail loudly, it just quietly adds a row to every player's sheet.

beforeEach(() => {
  vi.stubGlobal('__APP_VERSION__', '0.0.0-test')
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('showTurnBar', () => {
  it('is off for a device that has never set it', () => {
    expect(useSettingsStore().showTurnBar).toBe(false)
  })

  it('persists being turned on', async () => {
    const settings = useSettingsStore()
    settings.showTurnBar = true
    await nextTick()
    expect(localStorage.getItem('tm-show-turn-bar')).toBe('1')
  })

  it('is read back from storage on a fresh load', () => {
    localStorage.setItem('tm-show-turn-bar', '1')
    setActivePinia(createPinia())
    expect(useSettingsStore().showTurnBar).toBe(true)
  })

  // Persisted as an absent key rather than '0', matching the other display
  // flags — so a stale '0' from some other writer must not read as on.
  it('clears the key when turned back off', async () => {
    const settings = useSettingsStore()
    settings.showTurnBar = true
    await nextTick()
    settings.showTurnBar = false
    await nextTick()
    expect(localStorage.getItem('tm-show-turn-bar')).toBeNull()
  })
})
