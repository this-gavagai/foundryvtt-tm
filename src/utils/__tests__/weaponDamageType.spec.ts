import { describe, it, expect } from 'vitest'
import { effectiveDamageType } from '@/utils/weaponDamageType'

// A modular weapon stores WHICH face is selected as an index, and the array it
// indexes is built during preparation and never serialized — so a sheet painted
// from source alone showed the base type whatever the player had chosen.
//
// The live case: Harsk's Polytool is `bludgeoning` in source with
// `toggles.modular.selected: 1`, and `piercing` once PF2e has prepared it.
const weapon = (over: Record<string, unknown>) =>
  ({ system: { damage: { damageType: 'bludgeoning' }, traits: { value: [], ...over } } }) as never

describe('a weapon’s effective damage type', () => {
  it('resolves a modular index against the physical types', () => {
    const polytool = weapon({ value: ['agile', 'modular'], toggles: { modular: { selected: 1 } } })
    expect(effectiveDamageType(polytool)).toBe('piercing')
  })

  it('defaults a modular weapon to the first option, not to its own base', () => {
    // PF2e's index defaults to 0 and its options start at bludgeoning; a
    // weapon whose base is slashing still reads bludgeoning unselected.
    const unselected = {
      system: { damage: { damageType: 'slashing' }, traits: { value: ['modular'] } }
    } as never
    expect(effectiveDamageType(unselected)).toBe('bludgeoning')
  })

  it('falls back to the first option when the index is out of range', () => {
    const odd = weapon({ value: ['modular'], toggles: { modular: { selected: 9 } } })
    expect(effectiveDamageType(odd)).toBe('bludgeoning')
  })

  // The app's PF2e types declare this a string; PF2e and the app's own handler
  // both write a number. Reading only one would silently pick the wrong face.
  it('accepts the index as a number or a string', () => {
    expect(
      effectiveDamageType(weapon({ value: ['modular'], toggles: { modular: { selected: '2' } } }))
    ).toBe('slashing')
  })

  it('prefers an item’s own option list where it has one', () => {
    const custom = weapon({
      value: ['modular'],
      toggles: { modular: { selected: 0 } },
      config: { modular: [{ damageType: 'acid' }, { damageType: 'fire' }] }
    })
    expect(effectiveDamageType(custom)).toBe('acid')
  })

  it('lets a versatile selection win outright', () => {
    const dagger = weapon({
      value: ['versatile-s'],
      toggles: { versatile: { selected: 'slashing' } }
    })
    expect(effectiveDamageType(dagger)).toBe('slashing')
  })

  it('leaves an ordinary weapon alone', () => {
    expect(effectiveDamageType(weapon({ value: ['agile'] }))).toBe('bludgeoning')
    expect(effectiveDamageType(undefined)).toBeUndefined()
  })
})
