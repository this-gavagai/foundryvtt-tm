import { describe, it, expect } from 'vitest'
import {
  deriveArmorClass,
  deriveSpellDC,
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

describe('the class rank is a floor, not the value', () => {
  // Found live: a Kineticist whose class declares Will 1 but whose actor carries
  // rank 2. Seeding straight from the class overwrote it downwards and put the
  // save two points low — with NOTHING recorded, because the ledger watches
  // modifiers and this was the base.
  it('keeps a stored rank that is higher than the class’s', () => {
    const input = {
      ...fighter(),
      storedRanks: { 'system.saves.will.rank': 2 }
    }
    const { ranks } = deriveProficiencyRanks(input)
    expect(ranks['system.saves.will.rank']).toBe(2)
    // wis 1 + (expert 2 x 2 + 8) = 13, not the 11 the class floor alone gives.
    expect(deriveSave(input, 'will').value).toBe(13)
  })

  it('still raises a stored rank the class exceeds', () => {
    const input = { ...fighter(), storedRanks: { 'system.saves.fortitude.rank': 0 } }
    expect(deriveProficiencyRanks(input).ranks['system.saves.fortitude.rank']).toBe(2)
  })
})

describe('skill ranks come from more than the actor', () => {
  // The world dump carried ranks for four of one character's eight trained
  // skills; the rest arrive as AE-like upgrades, which cannot land on a path
  // that was never seeded.
  it('applies an AE-like upgrade to a skill the caller thinks is untrained', () => {
    const input = fighter([
      feature('Fire Gate', [
        { key: 'ActiveEffectLike', mode: 'upgrade', path: 'system.skills.intimidation.rank', value: 1 }
      ])
    ])
    // cha 0 + (trained 1 x 2 + 8) = 10, where a bare untrained read gives 0.
    expect(deriveSkill(input, 'intimidation', 0).value).toBe(10)
  })

  it('resolves an injected path, as every choose-a-skill feat uses one', () => {
    const input = fighter([
      {
        name: 'Skilled Human (Thievery)',
        type: 'heritage',
        system: {
          slug: 'skilled-human',
          // The real shape, read off a live character: the flag itself is not
          // persisted, but the ChoiceSet that writes it stores its answer.
          rules: [
            { key: 'ChoiceSet', flag: 'skill', selection: 'thievery' },
            {
              key: 'ActiveEffectLike',
              mode: 'upgrade',
              path: 'system.skills.{item|flags.system.rulesSelections.skill}.rank',
              value: 'ternary(gte(@actor.level,5),2,1)'
            }
          ]
        }
      } as never
    ])
    // Level 8, so the ternary picks 2: dex 2 + (expert 2 x 2 + 8) = 14.
    expect(deriveSkill(input, 'thievery', 0).value).toBe(14)
  })

  it('records an injected path it cannot resolve rather than dropping it', () => {
    // The silent case: an unresolvable injection never matched a seed key, so it
    // was discarded before the ledger could see it.
    const input = fighter([
      {
        name: 'Broken Choice',
        type: 'feat',
        system: {
          slug: 'broken-choice',
          rules: [
            {
              key: 'ActiveEffectLike',
              mode: 'upgrade',
              path: 'system.skills.{item|flags.system.rulesSelections.missing}.rank',
              value: 2
            }
          ]
        }
      } as never
    ])
    const result = deriveSkill(input, 'thievery', 0)
    expect(result.ledger.confidence).toBe('provisional')
    expect(result.ledger.skipped.some((skip) => skip.detail?.includes('unresolvable path'))).toBe(true)
  })
})

describe('rules that cannot move a number are not gaps', () => {
  it('ignores Note and AdjustDegreeOfSuccess', () => {
    // They attach text and shift outcome bands. Counting them made figures read
    // provisional when nothing affecting the number had been missed.
    // Asserted on a SKILL rather than a save: a save's rank is separately
    // unconfirmable from source, which would mask what this is testing.
    const input = fighter([
      feature('Assurance', [
        { key: 'Note', selector: 'athletics', text: 'something' },
        { key: 'AdjustDegreeOfSuccess', selector: 'athletics', adjustment: {} }
      ])
    ])
    expect(deriveSkill(input, 'athletics', 1).ledger.confidence).toBe('exact')
  })
})

describe('the base competes for stacking', () => {
  // Found live: every one of a character's eight trained skills read four points
  // high, because Untrained Improvisation is a `proficiency`-typed modifier and
  // the real proficiency bonus was being held outside the contest as a flat
  // base. PF2e's own modifier list shows the intended behaviour plainly.
  const untrainedImprovisation = feature('Untrained Improvisation', [
    {
      key: 'FlatModifier',
      selector: 'skill-check',
      type: 'proficiency',
      slug: 'untrained-improvisation',
      value: 'match(when(btwn(@actor.level,5,6), @actor.level - 1), when(gte(@actor.level,7), @actor.level))'
    }
  ])

  it('lets the real proficiency beat Untrained Improvisation on a trained skill', () => {
    // dex 2 + max(trained 1 x 2 + 8 = 10, improvisation 8) = 12, not 20.
    expect(deriveSkill(fighter([untrainedImprovisation]), 'acrobatics', 1).value).toBe(12)
  })

  it('lets Untrained Improvisation win where there is no proficiency', () => {
    // dex 2 + max(untrained 0, improvisation 8) = 10.
    expect(deriveSkill(fighter([untrainedImprovisation]), 'acrobatics', 0).value).toBe(10)
  })

  it('still stacks a modifier of a different type on top', () => {
    const input = fighter([
      untrainedImprovisation,
      feature('Lucky Charm', [
        { key: 'FlatModifier', selector: 'acrobatics', type: 'item', value: 1 }
      ])
    ])
    expect(deriveSkill(input, 'acrobatics', 1).value).toBe(13)
  })

  it('reports the base components in the modifier list', () => {
    // They are modifiers, so a breakdown that omitted them would be lying about
    // where the number came from.
    const slugs = deriveSkill(fighter(), 'athletics', 1).modifiers.map((m) => m.slug)
    expect(slugs).toContain('proficiency')
    expect(slugs).toContain('str')
  })
})

describe('an armour rank taken from the class baseline is not confirmed', () => {
  // Found live: a level 5 Cleric in Scale Mail derived AC 15 against PF2e's 22,
  // with an EMPTY ledger — seven points wrong while claiming to be exact, on the
  // number players trust most. Cleric grants only unarmoured training in its
  // class data; the medium-armour proficiency arrives through a doctrine that
  // writes nothing a world dump can see.
  const cleric = (extra: EngineItem[] = []): DerivationInput => ({
    level: 5,
    attributes: { str: 1, dex: 2, con: 2, int: 0, wis: 4, cha: 1 },
    stamp: STAMP,
    items: [
      {
        name: 'Cleric',
        type: 'class',
        system: {
          slug: 'cleric',
          rules: [],
          savingThrows: { fortitude: 1, reflex: 1, will: 2 },
          defenses: { unarmored: 1, light: 0, medium: 0, heavy: 0 },
          perception: 1,
          hp: 8
        } as unknown as EngineItem['system']
      },
      {
        name: 'Scale Mail',
        type: 'armor',
        system: {
          slug: 'scale-mail',
          rules: [],
          category: 'medium',
          acBonus: 3,
          dexCap: 2,
          equipped: { carryType: 'worn', inSlot: true }
        } as unknown as EngineItem['system']
      },
      ...extra
    ]
  })

  it('marks the figure rather than claiming the baseline is right', () => {
    const result = deriveArmorClass(cleric())
    // 10 + min(dex 2, cap 2) + untrained 0 + acBonus 3 = 15, which is what the
    // engine can justify — and it now says so instead of asserting it.
    expect(result.value).toBe(15)
    expect(result.ledger.confidence).toBe('provisional')
    expect(result.ledger.skipped.some((s) => s.reason === 'unconfirmable-rank')).toBe(true)
  })

  it('claims only the category actually worn', () => {
    const skipped = deriveArmorClass(cleric()).ledger.skipped.map((s) => s.slug)
    expect(skipped).toContain('system.proficiencies.defenses.medium.rank')
    // An unconfirmable heavy rank is no reason to doubt a figure in scale mail.
    expect(skipped).not.toContain('system.proficiencies.defenses.heavy.rank')
  })

  it('stays exact when a rule element actually grants the training', () => {
    const result = deriveArmorClass(
      cleric([
        feature('Warpriest Doctrine', [
          {
            key: 'ActiveEffectLike',
            mode: 'upgrade',
            path: 'system.proficiencies.defenses.medium.rank',
            value: 1
          }
        ])
      ])
    )
    // 10 + 2 + (trained 1 x 2 + 5) + 3 = 22 — PF2e's own number.
    expect(result.value).toBe(22)
    expect(result.ledger.confidence).toBe('exact')
  })
})

describe('proficiency subfeatures', () => {
  // The mechanism that made save and armour ranks look unrecoverable from
  // source. "Reflex Expertise" has an EMPTY rules array — there is no rule
  // element to find — but it carries the rank as plain stored data, and every
  // character on a live table had at least one of these.
  const withSubfeature = (proficiencies: Record<string, { rank: number }>) =>
    fighter([
      {
        name: 'Will Expertise',
        type: 'feat',
        system: { slug: 'will-expertise', rules: [], subfeatures: { proficiencies } }
      } as never
    ])

  it('raises a save rank with no rule element in sight', () => {
    const input = withSubfeature({ will: { rank: 2 } })
    expect(deriveProficiencyRanks(input).ranks['system.saves.will.rank']).toBe(2)
    // wis 1 + (expert 2 x 2 + 8) = 13, against the class baseline's 11.
    expect(deriveSave(input, 'will').value).toBe(13)
  })

  it('raises an armour rank, which is what AC was missing', () => {
    const input = withSubfeature({ medium: { rank: 2 } })
    expect(
      deriveProficiencyRanks(input).ranks['system.proficiencies.defenses.medium.rank']
    ).toBe(2)
  })

  it('raises perception', () => {
    const input = withSubfeature({ perception: { rank: 3 } })
    expect(deriveProficiencyRanks(input).ranks['system.perception.rank']).toBe(3)
  })

  it('never lowers a rank the class already grants', () => {
    // PF2e folds these in with Math.max, so a lesser subfeature is inert.
    const input = withSubfeature({ fortitude: { rank: 1 } })
    expect(deriveProficiencyRanks(input).ranks['system.saves.fortitude.rank']).toBe(2)
  })

  it('stops the figure claiming its rank is unconfirmable', () => {
    // The caveat exists for a rank taken from the class baseline alone. Once a
    // subfeature has spoken, keeping it would mark nearly every character and
    // teach the reader to ignore the marker.
    expect(deriveSave(withSubfeature({ will: { rank: 2 } }), 'will').ledger.confidence).toBe('exact')
    // …and it still fires where nothing explains the rank.
    expect(deriveSave(fighter(), 'will').ledger.confidence).toBe('provisional')
  })
})

describe('a chosen armour proficiency', () => {
  // Kyra, verbatim: a Cleric whose class grants only unarmoured training, with
  // Armor Proficiency (Medium) taken as a feat. Her AC read 15 against PF2e's
  // 22 — and with an EMPTY ledger, because an unresolvable injection on a
  // non-skill path was dropped before the ledger could see it.
  const kyra = (rules: unknown[]): DerivationInput => ({
    level: 5,
    attributes: { str: 1, dex: 2, con: 2, int: 0, wis: 4, cha: 1 },
    stamp: STAMP,
    items: [
      {
        name: 'Cleric',
        type: 'class',
        system: {
          slug: 'cleric',
          rules: [],
          savingThrows: { fortitude: 1, reflex: 1, will: 2 },
          defenses: { unarmored: 1, light: 0, medium: 0, heavy: 0 },
          perception: 1,
          hp: 8
        } as unknown as EngineItem['system']
      },
      {
        name: 'Scale Mail',
        type: 'armor',
        system: {
          slug: 'scale-mail',
          rules: [],
          category: 'medium',
          acBonus: 3,
          dexCap: 2,
          equipped: { carryType: 'worn', inSlot: true }
        } as unknown as EngineItem['system']
      },
      { name: 'Armor Proficiency (Medium)', type: 'feat', system: { slug: 'armor-proficiency', rules } } as never
    ]
  })

  const choice = { key: 'ChoiceSet', flag: 'armorProficiency', selection: 'medium' }
  const upgrade = {
    key: 'ActiveEffectLike',
    mode: 'upgrade',
    path: 'system.proficiencies.defenses.{item|flags.system.rulesSelections.armorProficiency}.rank',
    value: 'ternary(gte(@actor.level,13),2,1)'
  }

  it('reaches PF2e’s number once the ChoiceSet answers the path', () => {
    // 10 + min(dex 2, cap 2) + (trained 1 x 2 + 5) + acBonus 3 = 22.
    const result = deriveArmorClass(kyra([choice, upgrade]))
    expect(result.value).toBe(22)
    expect(result.ledger.confidence).toBe('exact')
  })

  it('records the gap rather than dropping it when the choice is missing', () => {
    const result = deriveArmorClass(kyra([upgrade]))
    expect(result.value).toBe(15)
    expect(result.ledger.skipped.some((s) => s.detail?.includes('unresolvable path'))).toBe(true)
  })
})

describe('spell DC', () => {
  // Left out of the first Tier 2 pass on the assumption it was "the same shape
  // as class DC". It is not: the rank is the GREATER of the entry's own
  // proficiency and the actor's base-spellcasting rank, and the attribute is the
  // ENTRY's — so one character can carry two entries with two different DCs.
  const entry = (over: Record<string, unknown> = {}) =>
    ({
      name: 'Arcane Spellcasting',
      type: 'spellcastingEntry',
      system: {
        slug: 'arcane-spellcasting',
        rules: [],
        ability: { value: 'int' },
        tradition: { value: 'arcane' },
        proficiency: { value: 1 },
        ...over
      }
    }) as never

  const wizard = (extra: EngineItem[] = []): DerivationInput => ({
    level: 5,
    attributes: { str: 0, dex: 3, con: 3, int: 4, wis: 2, cha: 0 },
    stamp: STAMP,
    items: [
      {
        name: 'Wizard',
        type: 'class',
        system: {
          slug: 'wizard',
          rules: [],
          savingThrows: { fortitude: 1, reflex: 1, will: 2 },
          defenses: { unarmored: 1, light: 0, medium: 0, heavy: 0 },
          perception: 1,
          spellcasting: 1,
          hp: 6
        } as unknown as EngineItem['system']
      },
      ...extra
    ]
  })

  it('is 10 + the entry’s attribute + its proficiency', () => {
    // 10 + int 4 + (trained 1 x 2 + 5) = 21
    expect(deriveSpellDC(wizard([entry()]), entry()).value).toBe(21)
  })

  it('takes the entry’s own attribute, not the class’s', () => {
    // A sorcerer-style entry on the same character keys off charisma.
    const cha = entry({ ability: { value: 'cha' }, tradition: { value: 'divine' } })
    // 10 + cha 0 + 7 = 17
    expect(deriveSpellDC(wizard([cha]), cha).value).toBe(17)
  })

  it('takes the greater of the entry rank and the actor’s spellcasting rank', () => {
    const input = wizard([
      entry(),
      {
        name: 'Expert Spellcaster',
        type: 'feat',
        system: { slug: 'expert-spellcaster', rules: [], subfeatures: { proficiencies: { spellcasting: { rank: 2 } } } }
      } as never
    ])
    // The entry still says trained; the actor says expert, and expert wins.
    // 10 + int 4 + (2 x 2 + 5) = 23
    expect(deriveSpellDC(input, entry()).value).toBe(23)
  })

  it('collects modifiers on the spell-dc domains', () => {
    const input = wizard([
      entry(),
      feature('Ring of Wizardry', [
        { key: 'FlatModifier', selector: 'spell-dc', type: 'item', value: 1 }
      ])
    ])
    expect(deriveSpellDC(input, entry()).value).toBe(22)
  })
})

describe('the reported modifier list', () => {
  it('marks stacking losers disabled rather than dropping or keeping them', () => {
    // PF2e reports both and flags the loser — a live character's untrained
    // Arcana shows `proficiency:0:proficiency:false` beside
    // `untrained-improvisation:4:proficiency:true`, reversing once trained.
    const input = fighter([
      feature('Untrained Improvisation', [
        {
          key: 'FlatModifier',
          selector: 'skill-check',
          type: 'proficiency',
          slug: 'untrained-improvisation',
          value: 4
        }
      ])
    ])
    const trained = deriveSkill(input, 'athletics', 1).modifiers
    const byslug = (list: typeof trained, slug: string) => list.find((m) => m.slug === slug)
    expect(byslug(trained, 'proficiency')?.enabled).toBe(true)
    expect(byslug(trained, 'untrained-improvisation')?.enabled).toBe(false)

    const untrained = deriveSkill(input, 'arcana', 0).modifiers
    expect(byslug(untrained, 'proficiency')?.enabled).toBe(false)
    expect(byslug(untrained, 'untrained-improvisation')?.enabled).toBe(true)
  })

  it('leaves untyped and forced modifiers enabled alongside a winner', () => {
    const input = fighter([
      feature('A', [{ key: 'FlatModifier', selector: 'ac', type: 'item', slug: 'a', value: 1 }]),
      feature('B', [{ key: 'FlatModifier', selector: 'ac', type: 'item', slug: 'b', value: 2 }]),
      feature('C', [{ key: 'FlatModifier', selector: 'ac', slug: 'c', value: 1 }])
    ])
    const mods = deriveArmorClass(input).modifiers
    expect(mods.find((m) => m.slug === 'a')?.enabled).toBe(false)
    expect(mods.find((m) => m.slug === 'b')?.enabled).toBe(true)
    expect(mods.find((m) => m.slug === 'c')?.enabled).toBe(true)
  })
})
