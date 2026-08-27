import { describe, it, expect, beforeEach } from 'vitest'
import { useSpellVariantMemory } from '@/composables/useSpellVariantMemory'

// The memory is module-scoped on purpose — the spell list and the roll modal
// are separate components expressing one running choice — so these tests reset
// the ids they use rather than the module.
const IGNITION = [{ overlayId: 'ranged' }, { overlayId: 'melee' }]

describe('useSpellVariantMemory', () => {
  let memory: ReturnType<typeof useSpellVariantMemory>

  beforeEach(() => {
    memory = useSpellVariantMemory()
  })

  it('has no opinion about a spell that has not been used', () => {
    expect(memory.lastVariant('untouched-spell', IGNITION)).toBeUndefined()
  })

  it('returns what was last used for that spell', () => {
    memory.rememberVariant('ignition', 'melee')
    expect(memory.lastVariant('ignition', IGNITION)).toBe('melee')
  })

  it('is shared across call sites — the list and the roll modal see one choice', () => {
    useSpellVariantMemory().rememberVariant('shared-spell', 'melee')
    expect(useSpellVariantMemory().lastVariant('shared-spell', IGNITION)).toBe('melee')
  })

  it('keeps spells independent of each other', () => {
    memory.rememberVariant('spell-a', 'melee')
    memory.rememberVariant('spell-b', 'ranged')
    expect(memory.lastVariant('spell-a', IGNITION)).toBe('melee')
    expect(memory.lastVariant('spell-b', IGNITION)).toBe('ranged')
  })

  it('overwrites on the next use rather than accumulating', () => {
    memory.rememberVariant('changing', 'melee')
    memory.rememberVariant('changing', 'ranged')
    expect(memory.lastVariant('changing', IGNITION)).toBe('ranged')
  })

  // A spell's overlays can change under us — a staff re-prepared overnight, an
  // item edited. A remembered id that no longer exists would select nothing and
  // leave the control looking unset, so it must read as "no memory" instead.
  it('forgets a variant the spell no longer offers', () => {
    memory.rememberVariant('rewritten', 'melee')
    expect(memory.lastVariant('rewritten', [{ overlayId: 'something-else' }])).toBeUndefined()
  })

  it('ignores writes with nothing to record', () => {
    memory.rememberVariant(undefined, 'melee')
    memory.rememberVariant('blank-choice', undefined)
    expect(memory.lastVariant('blank-choice', IGNITION)).toBeUndefined()
  })

  it('has no opinion when asked about no spell at all', () => {
    expect(memory.lastVariant(undefined, IGNITION)).toBeUndefined()
    expect(memory.lastVariant(null, IGNITION)).toBeUndefined()
  })
})
