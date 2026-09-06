import { describe, it, expect } from 'vitest'
import { deriveMovement, deriveFocusPool, type DerivationInput } from '@/utils/ruleEngine/statistics'
import type { EngineItem } from '@/utils/ruleEngine/flatModifiers'

const STAMP = 'pf2e@8.4.1|en|1.4.0'

const elf = {
  name: 'Elf',
  type: 'ancestry',
  system: { slug: 'elf', rules: [], speed: 30, size: 'med', traits: { value: ['elf'] } }
} as unknown as EngineItem

const dwarf = {
  name: 'Dwarf',
  type: 'ancestry',
  system: { slug: 'dwarf', rules: [], speed: 20, size: 'med', traits: { value: ['dwarf'] } }
} as unknown as EngineItem

const armor = (over: Record<string, unknown>): EngineItem =>
  ({
    name: 'Half Plate',
    type: 'armor',
    system: {
      slug: 'half-plate',
      rules: [],
      category: 'heavy',
      acBonus: 5,
      dexCap: 1,
      speedPenalty: -10,
      strength: 3,
      traits: { value: [] },
      equipped: { carryType: 'worn', inSlot: true },
      ...over
    }
  }) as unknown as EngineItem

const feature = (name: string, rules: unknown[]): EngineItem => ({
  name,
  type: 'feat',
  system: { slug: name.toLowerCase().replace(/ /g, '-'), rules }
})

const character = (items: EngineItem[], str = 0): DerivationInput => ({
  level: 5,
  attributes: { str, dex: 2, con: 2, int: 0, wis: 1, cha: 0 },
  traits: ['elf'],
  stamp: STAMP,
  items: [
    {
      name: 'Fighter',
      type: 'class',
      system: {
        slug: 'fighter',
        rules: [],
        savingThrows: { fortitude: 2, reflex: 2, will: 1 },
        defenses: { unarmored: 1, light: 1, medium: 1, heavy: 1 },
        perception: 2,
        hp: 10
      } as unknown as EngineItem['system']
    },
    ...items
  ]
})

describe('land speed', () => {
  // The base is not on the actor at all: a world dump carries no
  // `system.movement`, and PF2e writes land from the ancestry item.
  it('comes from the ancestry item', () => {
    expect(deriveMovement(character([elf])).land?.value).toBe(30)
    expect(deriveMovement(character([dwarf])).land?.value).toBe(20)
  })

  it('is zero with no ancestry rather than a guessed default', () => {
    expect(deriveMovement(character([])).land?.value).toBe(0)
  })

  it('takes the armour speed penalty', () => {
    // Half plate is -10, strength requirement 3, and this character has +0.
    expect(deriveMovement(character([elf, armor({})], 0)).land?.value).toBe(20)
  })

  it('eases the penalty by five when the strength requirement is met', () => {
    expect(deriveMovement(character([elf, armor({})], 3)).land?.value).toBe(25)
  })

  it('never turns an eased penalty into a bonus', () => {
    // -5 eased by 5 is 0, not +0-and-then-some; and a nonsensical positive
    // penalty is clamped rather than added.
    expect(deriveMovement(character([elf, armor({ speedPenalty: -5 })], 3)).land?.value).toBe(30)
    expect(deriveMovement(character([elf, armor({ speedPenalty: 5 })], 3)).land?.value).toBe(30)
  })

  it('ignores armour that is not worn', () => {
    const stowed = armor({ equipped: { carryType: 'stowed', inSlot: false } })
    expect(deriveMovement(character([elf, stowed])).land?.value).toBe(30)
  })

  it('applies the hindering trait as a flat five', () => {
    const hindering = armor({ speedPenalty: 0, traits: { value: ['hindering'] } })
    expect(deriveMovement(character([elf, hindering])).land?.value).toBe(25)
  })

  it('takes a held shield’s speed penalty', () => {
    const shield = {
      name: 'Tower Shield',
      type: 'shield',
      system: {
        slug: 'tower-shield',
        rules: [],
        speedPenalty: -5,
        equipped: { carryType: 'held', handsHeld: 1 }
      }
    } as unknown as EngineItem
    expect(deriveMovement(character([elf, shield])).land?.value).toBe(25)
  })

  it('is raised, never lowered, by a BaseSpeed rule', () => {
    const fleet = feature('Fleet Feet', [{ key: 'BaseSpeed', selector: 'land', value: 35 }])
    const slow = feature('Slow', [{ key: 'BaseSpeed', selector: 'land', value: 15 }])
    expect(deriveMovement(character([elf, fleet])).land?.value).toBe(35)
    expect(deriveMovement(character([elf, slow])).land?.value).toBe(30)
  })

  it('never goes below zero', () => {
    const crushing = armor({ speedPenalty: -40 })
    expect(deriveMovement(character([dwarf, crushing])).land?.value).toBe(0)
  })
})

describe('other speeds', () => {
  it('are absent unless something grants them', () => {
    const speeds = deriveMovement(character([elf]))
    expect(speeds.swim).toBeNull()
    expect(speeds.fly).toBeNull()
    expect(speeds.climb).toBeNull()
    expect(speeds.burrow).toBeNull()
  })

  it('come from a BaseSpeed rule, taking the highest', () => {
    const items = [
      elf,
      feature('Swim A', [{ key: 'BaseSpeed', selector: 'swim', value: 15 }]),
      feature('Swim B', [{ key: 'BaseSpeed', selector: 'swim', value: 25 }])
    ]
    expect(deriveMovement(character(items)).swim?.value).toBe(25)
  })

  it('accept the selector with or without the -speed suffix', () => {
    const items = [elf, feature('Flier', [{ key: 'BaseSpeed', selector: 'fly-speed', value: 30 }])]
    expect(deriveMovement(character(items)).fly?.value).toBe(30)
  })

  // The subtle one. A land-derived speed inherits land's TOTAL, so the armour
  // penalty is already in it — collecting `all-speeds` again would apply it a
  // second time.
  it('inherit land’s already-penalised total when derived from land', () => {
    const items = [
      elf,
      armor({}),
      feature('Aquatic', [
        {
          key: 'BaseSpeed',
          selector: 'swim',
          value: '@actor.system.movement.speeds.land.value'
        }
      ])
    ]
    const speeds = deriveMovement(character(items, 0))
    expect(speeds.land?.value).toBe(20)
    expect(speeds.swim?.value).toBe(20)
  })

  it('do not inherit land when the value is a plain number', () => {
    const items = [
      elf,
      armor({}),
      feature('Aquatic', [{ key: 'BaseSpeed', selector: 'swim', value: 30 }])
    ]
    const speeds = deriveMovement(character(items, 0))
    // Its own base, and the armour penalty applies to it on `all-speeds`.
    expect(speeds.swim?.value).toBe(20)
    expect(speeds.swim?.base).toBe(30)
  })

  it('report a skipped rule rather than a confident absence', () => {
    const items = [
      elf,
      feature('Maybe Fly', [
        {
          key: 'BaseSpeed',
          selector: 'fly',
          value: 30,
          predicate: ['weather:storm']
        }
      ])
    ]
    const fly = deriveMovement(character(items)).fly
    expect(fly).not.toBeNull()
    expect(fly?.value).toBe(0)
    expect(fly?.ledger.skipped.length).toBe(1)
  })
})

describe('focus pool maximum', () => {
  const focusSpell = (name: string, traits: string[]): EngineItem =>
    ({
      name,
      type: 'spell',
      system: { slug: name.toLowerCase(), rules: [], traits: { value: traits } }
    }) as unknown as EngineItem

  // The correction to a claim this project made twice in writing: the pool is
  // not a lookup table of feats. PF2e resets the stored maximum to zero and
  // counts the character's focus spells.
  it('is one per non-cantrip focus spell', () => {
    const items = [
      focusSpell('Hand of the Apprentice', ['focus', 'wizard']),
      focusSpell('Shield', ['cantrip']),
      focusSpell('Lay on Hands', ['focus', 'healing'])
    ]
    expect(deriveFocusPool(character(items)).max).toBe(2)
  })

  it('does not count a focus cantrip', () => {
    const items = [focusSpell('Shifting Form', ['focus', 'cantrip'])]
    expect(deriveFocusPool(character(items)).max).toBe(0)
  })

  it('caps at three', () => {
    const items = Array.from({ length: 6 }, (_, i) => focusSpell(`Focus ${i}`, ['focus']))
    expect(deriveFocusPool(character(items)).max).toBe(3)
  })

  it('respects an ActiveEffectLike raising the cap', () => {
    const items = [
      ...Array.from({ length: 5 }, (_, i) => focusSpell(`Focus ${i}`, ['focus'])),
      feature('Deep Well', [
        {
          key: 'ActiveEffectLike',
          mode: 'upgrade',
          path: 'system.resources.focus.cap',
          value: 4
        }
      ])
    ]
    expect(deriveFocusPool(character(items)).max).toBe(4)
  })

  it('respects an ActiveEffectLike adding to the maximum directly', () => {
    const items = [
      focusSpell('Hand of the Apprentice', ['focus']),
      feature('Psi Development', [
        {
          key: 'ActiveEffectLike',
          mode: 'add',
          path: 'system.resources.focus.max',
          value: 1
        }
      ])
    ]
    expect(deriveFocusPool(character(items)).max).toBe(2)
  })

  it('is zero for a character with no focus spells', () => {
    expect(deriveFocusPool(character([elf])).max).toBe(0)
  })
})
