import { describe, it, expect } from 'vitest'
import {
  deriveArmorClass,
  deriveClassDC,
  deriveHitPointsMax,
  derivePerception,
  deriveProficiencyRanks,
  deriveSave,
  deriveSkill,
  proficiencyBonus,
  type DerivationInput
} from '@/utils/ruleEngine/statistics'
import type { EngineItem } from '@/utils/ruleEngine/flatModifiers'

const STAMP = 'pf2e@8.4.1|en|1.4.0'

// A level 8 fighter: expert Fortitude and Reflex from the class, heavy armour
// trained, d10 hit points.
const fighter = (extra: EngineItem[] = [], level = 8): DerivationInput => ({
  level,
  attributes: { str: 4, dex: 2, con: 3, int: 0, wis: 1, cha: 0 },
  traits: ['human'],
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
    {
      name: 'Human',
      type: 'ancestry',
      system: { slug: 'human', rules: [], hp: 8 } as unknown as EngineItem['system']
    },
    ...extra
  ]
})

const feature = (name: string, rules: unknown[]): EngineItem => ({
  name,
  type: 'feat',
  system: { slug: name.toLowerCase().replace(/ /g, '-'), rules }
})

describe('proficiency bonus', () => {
  it('is rank x 2 + level, and zero when untrained', () => {
    expect(proficiencyBonus(0, 8)).toBe(0)
    expect(proficiencyBonus(1, 8)).toBe(10)
    expect(proficiencyBonus(3, 8)).toBe(14)
  })
})

describe('proficiency ranks', () => {
  it('seeds from the class item’s own stored ranks', () => {
    const { ranks } = deriveProficiencyRanks(fighter())
    expect(ranks['system.saves.fortitude.rank']).toBe(2)
    expect(ranks['system.saves.will.rank']).toBe(1)
    expect(ranks['system.proficiencies.defenses.heavy.rank']).toBe(1)
  })

  it('lets a class feature upgrade one', () => {
    // Juggernaut and its kin are ActiveEffectLike upgrades. Without this the
    // rank stays at its level-1 value for the character's whole career.
    const { ranks } = deriveProficiencyRanks(
      fighter([
        feature('Juggernaut', [
          {
            key: 'ActiveEffectLike',
            mode: 'upgrade',
            path: 'system.saves.fortitude.rank',
            value: 3
          }
        ])
      ])
    )
    expect(ranks['system.saves.fortitude.rank']).toBe(3)
  })

  it('does not let an upgrade lower an already-higher rank', () => {
    const { ranks } = deriveProficiencyRanks(
      fighter([
        feature('Weak Sauce', [
          {
            key: 'ActiveEffectLike',
            mode: 'upgrade',
            path: 'system.saves.fortitude.rank',
            value: 1
          }
        ])
      ])
    )
    expect(ranks['system.saves.fortitude.rank']).toBe(2)
  })

  it('applies rules in priority order, because the modes do not commute', () => {
    const { ranks } = deriveProficiencyRanks(
      fighter([
        feature('Later Add', [
          {
            key: 'ActiveEffectLike',
            mode: 'add',
            path: 'system.perception.rank',
            value: 1,
            priority: 90
          }
        ]),
        feature('Earlier Override', [
          {
            key: 'ActiveEffectLike',
            mode: 'override',
            path: 'system.perception.rank',
            value: 0,
            priority: 10
          }
        ])
      ])
    )
    // override(0) then add(1) = 1. The other order would give 0.
    expect(ranks['system.perception.rank']).toBe(1)
  })
})

describe('saves', () => {
  it('is attribute + proficiency', () => {
    // Con 3 + (expert 2 x 2 + level 8) = 3 + 12 = 15
    expect(deriveSave(fighter(), 'fortitude').value).toBe(15)
  })

  it('picks up a class feature’s rank upgrade', () => {
    const result = deriveSave(
      fighter([
        feature('Juggernaut', [
          {
            key: 'ActiveEffectLike',
            mode: 'upgrade',
            path: 'system.saves.fortitude.rank',
            value: 3
          }
        ])
      ]),
      'fortitude'
    )
    // master: 3 + (3 x 2 + 8) = 17
    expect(result.value).toBe(17)
    expect(result.ledger.confidence).toBe('exact')
  })

  it('adds a FlatModifier aimed at saves', () => {
    const result = deriveSave(
      fighter([
        feature('Resilient', [
          { key: 'FlatModifier', selector: 'saving-throw', type: 'item', value: 1 }
        ])
      ]),
      'fortitude'
    )
    expect(result.value).toBe(16)
  })
})

describe('skills', () => {
  it('uses the actor’s stored rank and the skill’s own attribute', () => {
    // Athletics is Str: 4 + (trained 1 x 2 + 8) = 14
    expect(deriveSkill(fighter(), 'athletics', 1).value).toBe(14)
    // Stealth is Dex, untrained: 2 + 0 = 2
    expect(deriveSkill(fighter(), 'stealth', 0).value).toBe(2)
  })

  it('treats a lore as Int-keyed', () => {
    expect(deriveSkill(fighter(), 'warfare-lore', 2, { lore: true }).value).toBe(0 + (2 * 2 + 8))
  })
})

describe('armour class', () => {
  const armor = (over: Record<string, unknown>): EngineItem => ({
    name: 'Half Plate',
    type: 'armor',
    system: {
      slug: 'half-plate',
      rules: [],
      category: 'heavy',
      acBonus: 5,
      dexCap: 1,
      equipped: { carryType: 'worn', inSlot: true },
      ...over
    } as unknown as EngineItem['system']
  })

  it('caps dexterity at the armour’s limit', () => {
    // 10 + min(dex 2, cap 1) + (trained 1 x 2 + 8) + acBonus 5 = 26
    expect(deriveArmorClass(fighter([armor({})])).value).toBe(26)
  })

  it('uses the unarmoured category when nothing is worn', () => {
    // 10 + dex 2 + (unarmored trained 1 x 2 + 8) = 22
    expect(deriveArmorClass(fighter()).value).toBe(22)
  })

  it('adds a potency rune', () => {
    expect(deriveArmorClass(fighter([armor({ runes: { potency: 2 } })])).value).toBe(28)
  })

  it('ignores armour that is carried rather than worn', () => {
    expect(deriveArmorClass(fighter([armor({ equipped: { carryType: 'carried' } })])).value).toBe(
      22
    )
  })
})

describe('hit points', () => {
  it('is ancestry + (class + con) x level', () => {
    // 8 + (10 + 3) x 8 = 112
    expect(deriveHitPointsMax(fighter()).value).toBe(112)
  })

  it('picks up Toughness, which adds the character’s level', () => {
    // Toughness resolves through @actor.level rather than a flat number, which
    // is why the value resolver has to handle paths at all.
    const result = deriveHitPointsMax(
      fighter([
        feature('Toughness', [{ key: 'FlatModifier', selector: 'hp', value: '@actor.level' }])
      ])
    )
    expect(result.value).toBe(120)
    expect(result.ledger.confidence).toBe('exact')
  })
})

describe('perception', () => {
  it('is wisdom + the class’s perception proficiency', () => {
    // Wis 1 + (expert 2 x 2 + level 8) = 13
    expect(derivePerception(fighter()).value).toBe(13)
  })

  it('picks up an initiative-adjacent FlatModifier aimed at perception', () => {
    const result = derivePerception(
      fighter([
        feature('Keen Eyes', [
          { key: 'FlatModifier', selector: 'perception', type: 'item', value: 2 }
        ])
      ])
    )
    expect(result.value).toBe(15)
  })
})

describe('class DC', () => {
  it('is 10 + key attribute + proficiency', () => {
    // 10 + str 4 + (trained 1 x 2 + 8) = 24
    expect(deriveClassDC(fighter(), 'str').value).toBe(24)
  })
})

describe('the ledger travels with the figure', () => {
  it('a rank rule it cannot resolve makes the save provisional', () => {
    const result = deriveSave(
      fighter([
        feature('Conditional', [
          {
            key: 'ActiveEffectLike',
            mode: 'upgrade',
            path: 'system.saves.fortitude.rank',
            value: 3,
            predicate: ['self:armored']
          }
        ])
      ]),
      'fortitude'
    )
    // The rank upgrade was skipped, so the number is the un-upgraded one AND
    // the figure says it might be low.
    expect(result.value).toBe(15)
    expect(result.ledger.confidence).toBe('provisional')
    expect(result.ledger.skipped[0].slug).toBe('system.saves.fortitude.rank')
  })

  it('an unverified system version downgrades even a clean figure', () => {
    const input = { ...fighter(), stamp: 'pf2e@9.0.0|en|1.0.0' }
    expect(deriveSave(input, 'fortitude').ledger.confidence).toBe('unverified')
  })
})
