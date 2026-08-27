// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import type { Ref } from 'vue'
import type { TablemateNpc } from '@/types/character-types'

// The model only needs these to exist as call targets; the roll/write plumbing
// is exercised by its own tests.
const rollCheck = vi.fn()
const getStrikeDamage = vi.fn()
const getSpellDamage = vi.fn()
const castSpell = vi.fn()
const updateActorItem = vi.fn(() => Promise.resolve(null))
vi.mock('@/api/actionRpc', () => ({
  rollCheck: (...args: unknown[]) => rollCheck(...args),
  rollDamage: vi.fn(),
  getStrikeDamage: (...args: unknown[]) => getStrikeDamage(...args),
  getSpellDamage: (...args: unknown[]) => getSpellDamage(...args),
  castSpell: (...args: unknown[]) => castSpell(...args)
}))
vi.mock('@/api/documents', () => ({
  updateActor: vi.fn(() => Promise.resolve(null)),
  updateActorItem: (...args: unknown[]) => updateActorItem(...(args as [])),
  deleteActorItem: vi.fn(() => Promise.resolve(null))
}))

const { useNpc } = await import('@/composables/npc')

// A Wolf (Pathfinder Monster Core) as it arrives over the socket: source data
// with the prepared statistic traces overlaid — the shape getCharacterDetails
// builds. Trimmed to the fields the model reads.
function wolf(): TablemateNpc {
  return {
    _id: 'BN5Lb6IsQ9Wyu3rL',
    name: 'Wolf',
    type: 'npc',
    img: 'systems/pf2e/icons/default-icons/npc.svg',
    traitLabels: { animal: 'Animal', common: 'Common', knockdown: 'Knockdown' },
    system: {
      abilities: {
        str: { mod: 2 },
        dex: { mod: 4 },
        con: { mod: 1 },
        int: { mod: -4 },
        wis: { mod: 2 },
        cha: { mod: -2 }
      },
      attributes: {
        ac: { value: 15, details: '', modifiers: [] },
        adjustment: null,
        allSaves: { value: '+1 status to all saves vs. magic' },
        hp: { value: 20, max: 24, temp: 0, details: 'regenerates 2' },
        speed: { value: 35, otherSpeeds: [], details: 'ignores difficult terrain' },
        immunities: [],
        weaknesses: [],
        resistances: []
      },
      details: {
        blurb: 'Ferocious pack hunter',
        level: { value: 1 },
        publicNotes: '<p>Wolves live and hunt in packs.</p>'
      },
      initiative: { statistic: 'perception', totalModifier: 7, modifiers: [] },
      movement: { speeds: { land: { value: 35, breakdown: '35 feet' } } },
      perception: {
        details: 'has scent',
        mod: 7,
        totalModifier: 7,
        senses: [
          { type: 'low-light-vision', label: 'Low-Light Vision' },
          { type: 'scent', label: 'Scent', acuity: 'imprecise', range: 30 }
        ]
      },
      saves: {
        fortitude: { totalModifier: 6, saveDetail: '', slug: 'fortitude', label: 'Fortitude' },
        reflex: { totalModifier: 9, saveDetail: '', slug: 'reflex', label: 'Reflex' },
        will: { totalModifier: 5, saveDetail: '', slug: 'will', label: 'Will' }
      },
      // PF2e gives an NPC a statistic for every skill; only the trained ones
      // are flagged visible.
      skills: {
        acrobatics: { slug: 'acrobatics', label: 'Acrobatics', totalModifier: 7, visible: true },
        athletics: { slug: 'athletics', label: 'Athletics', totalModifier: 6, visible: true },
        arcana: { slug: 'arcana', label: 'Arcana', totalModifier: -4, visible: false },
        stealth: { slug: 'stealth', label: 'Stealth', totalModifier: 7, visible: true }
      },
      traits: { rarity: 'common', size: { value: 'med' }, value: ['animal'] },
      actions: [
        {
          type: 'strike',
          slug: 'jaws',
          label: 'Jaws',
          attackRollType: 'PF2E.NPCAttackMelee',
          additionalEffects: [{ tag: 'knockdown', label: 'PF2E.AttackEffectKnockdown' }],
          traits: [{ name: 'unarmed', label: 'Unarmed' }],
          _modifiers: [{ slug: 'base', label: 'Modifier', modifier: 9, enabled: true }],
          variants: [{ label: 'Strike +9' }, { label: 'MAP -5 (+4)' }, { label: 'MAP -10 (-1)' }],
          item: { _id: 'meleeJaws01' }
        },
        // An area attack carries a save DC instead of attack variants and isn't
        // rollable through the strike path.
        { type: 'area-attack', slug: 'area-fire', label: 'Area Fire' }
      ]
    },
    items: [
      {
        _id: 'meleeJaws01',
        name: 'Jaws',
        type: 'melee',
        img: 'systems/pf2e/icons/default-icons/melee.svg',
        system: {
          slug: null,
          traits: { rarity: 'common', value: ['unarmed'] },
          weaponType: { value: 'melee' }
        }
      },
      {
        _id: 'actionPack01',
        name: 'Pack Attack',
        type: 'action',
        system: {
          actionType: { value: 'passive' },
          actions: { value: null },
          description: { value: '<p>extra damage</p>' },
          traits: { rarity: 'common', value: [] }
        }
      },
      {
        _id: 'actionKnock01',
        name: 'Knockdown',
        type: 'action',
        system: {
          actionType: { value: 'action' },
          actions: { value: 1 },
          description: { value: '<p>knock prone</p>' },
          traits: { rarity: 'common', value: [] }
        }
      }
    ]
  } as unknown as TablemateNpc
}

// ref()'s return type deep-unwraps its argument, which for a PF2e document
// class strips the methods and no longer matches TablemateNpc. The sheets dodge
// this by declaring the ref before filling it (`const actor: Ref<...> = ref()`);
// here one cast at the seam keeps the fixture readable.
const actorRef = (actor?: TablemateNpc): Ref<TablemateNpc | undefined> =>
  ref(actor) as Ref<TablemateNpc | undefined>

describe('useNpc', () => {
  it('exposes the stat-block identity fields', () => {
    const { npc } = useNpc(actorRef(wolf()))
    expect(npc.name.value).toBe('Wolf')
    expect(npc.level.value).toBe(1)
    expect(npc.blurb.value).toBe('Ferocious pack hunter')
    expect(npc.size.value).toBe('med')
    expect(npc.rarity.value).toBe('common')
    expect(npc.traits.value).toEqual(['animal'])
    expect(npc.adjustment.value).toBeNull()
  })

  it('reads defenses, ability modifiers and speeds', () => {
    const { npc } = useNpc(actorRef(wolf()))
    expect(npc.ac.current.value).toBe(15)
    expect(npc.hp.current.value).toBe(20)
    expect(npc.hp.max.value).toBe(24)
    expect(npc.saves.reflex.value?.totalModifier).toBe(9)
    expect(npc.perception.value?.totalModifier).toBe(7)
    expect(npc.attributes?.dex.value).toBe(4)
    expect(npc.movement.land.value?.value).toBe(35)
    expect(npc.initiative?.totalModifier.value).toBe(7)
  })

  it('keeps the free-text stat-block notes the trace data drops', () => {
    const { npc } = useNpc(actorRef(wolf()))
    expect(npc.hpDetails.value).toBe('regenerates 2')
    expect(npc.allSavesDetails.value).toBe('+1 status to all saves vs. magic')
    expect(npc.perceptionDetails.value).toBe('has scent')
    expect(npc.speedDetails.value).toBe('ignores difficult terrain')
    // An empty string is "no note", not a note that renders as a blank line.
    expect(npc.acDetails.value).toBeUndefined()
  })

  it('lists senses with their localized label, acuity and range', () => {
    const { npc } = useNpc(actorRef(wolf()))
    expect(npc.senses.value).toEqual([
      { type: 'low-light-vision', label: 'Low-Light Vision', acuity: undefined, range: undefined },
      { type: 'scent', label: 'Scent', acuity: 'imprecise', range: 30 }
    ])
  })

  it('shows only the skills the creature is trained in', () => {
    const { npc } = useNpc(actorRef(wolf()))
    expect(npc.skills.value?.map((s) => s.slug)).toEqual(['acrobatics', 'athletics', 'stealth'])
  })

  it('builds a rollable strike per attack, skipping area attacks', () => {
    const { npc } = useNpc(actorRef(wolf()))
    const strikes = npc.strikes.value ?? []
    expect(strikes).toHaveLength(1)
    const jaws = strikes[0]
    expect(jaws.label).toBe('Jaws')
    expect(jaws.isRanged).toBe(false)
    expect(jaws.item?.name).toBe('Jaws')
    expect(jaws.altUsages).toBeUndefined()
    // The MAP-0 label is trimmed to the bare modifier so the shared
    // StrikeActionSet doesn't render "Strike Strike +9".
    expect(jaws.variants.map((v) => v.label)).toEqual(['+9', 'MAP -5 (+4)', 'MAP -10 (-1)'])
    expect(jaws._modifiers?.[0]?.modifier).toBe(9)
  })

  it('localizes attack effects through the world trait labels', () => {
    const { npc } = useNpc(actorRef(wolf()))
    expect(npc.strikes.value?.[0]?.attackEffects).toEqual(['Knockdown'])
  })

  it('rolls a strike by action slug, variant and no alt usage', () => {
    const { npc } = useNpc(actorRef(wolf()))
    npc.strikes.value?.[0]?.doStrike?.(1, undefined, undefined, 14)
    expect(rollCheck).toHaveBeenCalledWith(
      expect.anything(),
      'strike',
      { actionSlug: 'jaws', variant: 1, altUsage: undefined },
      { d20: [14] },
      [],
      {}
    )
  })

  it('splits abilities into active and passive', () => {
    const { npc } = useNpc(actorRef(wolf()))
    expect(npc.activeAbilities.value?.map((a) => a.name)).toEqual(['Knockdown'])
    expect(npc.passiveAbilities.value?.map((a) => a.name)).toEqual(['Pack Attack'])
    expect(npc.activeAbilities.value?.[0]?.system?.actions?.value).toBe(1)
  })

  it('survives an actor that has not loaded yet', () => {
    const { npc } = useNpc(actorRef())
    expect(npc.name.value).toBeUndefined()
    expect(npc.strikes.value).toEqual([])
    expect(npc.skills.value).toEqual([])
    expect(npc.senses.value).toEqual([])
    expect(npc.activeAbilities.value).toEqual([])
  })
})

// A Cuckoo Hag (Pathfinder Monster Core): two innate occult entries, one spell
// heightened above its base rank, one with authored uses, one at the PF2e-derived
// 1/1 default, and a cantrip. Plus a prepared entry, since a quarter of bestiary
// spells sit in those and they still need slot accounting.
function hag(): TablemateNpc {
  return {
    _id: 'hagActor01',
    name: 'Cuckoo Hag',
    type: 'npc',
    traitLabels: {},
    spellcastingModifiers: {
      innate01: { mod: 21, dc: 31, modifiers: [{ slug: 'base', modifier: 21, enabled: true }] },
      prep01: { mod: 18, dc: 28, modifiers: [] }
    },
    system: {
      abilities: {},
      attributes: { hp: { value: 200, max: 200 }, spellDC: { value: 31 } },
      details: { level: { value: 12 } },
      perception: {},
      resources: { focus: { value: 1, max: 2 } },
      saves: {},
      skills: {},
      traits: { value: [] },
      actions: []
    },
    items: [
      {
        _id: 'innate01',
        name: 'Occult Innate Spells',
        type: 'spellcastingEntry',
        sort: 200000,
        system: {
          prepared: { value: 'innate' },
          tradition: { value: 'occult' },
          // The book DC; an elite adjustment would move only the prepared one.
          spelldc: { dc: 29, value: 21 },
          slots: {}
        }
      },
      {
        _id: 'prep01',
        name: 'Prepared Spells',
        type: 'spellcastingEntry',
        sort: 100000,
        system: {
          prepared: { value: 'prepared' },
          tradition: { value: 'arcane' },
          spelldc: { dc: 28, value: 18 },
          slots: { slot3: { value: 1, max: 2, prepared: [{ id: 'fireball' }, { id: null }] } }
        }
      },
      {
        _id: 'meta',
        name: 'Cursed Metamorphosis',
        type: 'spell',
        system: {
          level: { value: 6 },
          location: { value: 'innate01', heightenedLevel: 8, uses: { value: 1, max: 1 } },
          traits: { value: ['concentrate'] },
          time: { value: '2' },
          description: { value: '<p>curse them</p>' }
        }
      },
      {
        _id: 'dominate',
        name: 'Dominate',
        type: 'spell',
        system: {
          level: { value: 6 },
          location: { value: 'innate01', uses: { value: 0, max: 2 } },
          traits: { value: ['concentrate'] },
          description: { value: '' }
        }
      },
      {
        _id: 'daze',
        name: 'Daze',
        type: 'spell',
        system: {
          level: { value: 1 },
          location: { value: 'innate01', uses: { value: 1, max: 1 } },
          traits: { value: ['cantrip'] },
          description: { value: '' }
        }
      },
      {
        _id: 'fireball',
        name: 'Fireball',
        type: 'spell',
        system: {
          level: { value: 3 },
          location: { value: 'prep01' },
          traits: { value: [] },
          description: { value: '' }
        }
      }
    ]
  } as unknown as TablemateNpc
}

describe('useNpc — spellcasting', () => {
  it('lists entries in Foundry sort order with their statistic and DC', () => {
    const { npc } = useNpc(actorRef(hag()))
    const entries = npc.spellcastingEntries.value ?? []
    expect(entries.map((e) => e._id)).toEqual(['prep01', 'innate01'])
    const innate = entries.find((e) => e._id === 'innate01')
    expect(innate?.spellAttackModifier).toBe(21)
    expect(innate?.spellAttackModifiers?.[0]?.modifier).toBe(21)
    // The prepared DC wins over the entry's stored book value.
    expect(innate?.preparedDc).toBe(31)
    expect(innate?.system.spelldc?.dc).toBe(29)
  })

  it('casts a heightened innate spell at its heightened rank', () => {
    const { npc } = useNpc(actorRef(hag()))
    const meta = npc.spells.value?.find((s) => s._id === 'meta')
    expect(meta?.castRank).toBe(8)
    meta?.doSpell?.(undefined, undefined)
    // Trailing undefined: no spell variant was chosen for this cast.
    expect(castSpell).toHaveBeenCalledWith(expect.anything(), 'meta', 8, 0, undefined)
  })

  it('leaves a cantrip without a cast rank so Foundry auto-scales it', () => {
    const { npc } = useNpc(actorRef(hag()))
    expect(npc.spells.value?.find((s) => s._id === 'daze')?.castRank).toBeUndefined()
  })

  it('surfaces per-spell innate uses, which stand in for slots', () => {
    const { npc } = useNpc(actorRef(hag()))
    const spells = npc.spells.value ?? []
    expect(spells.find((s) => s._id === 'meta')?.uses).toEqual({ value: 1, max: 1 })
    // Spent: the sheet greys the cast button for this one.
    expect(spells.find((s) => s._id === 'dominate')?.uses).toEqual({ value: 0, max: 2 })
    // A prepared spell spends its entry's slot, not per-spell uses.
    expect(spells.find((s) => s._id === 'fireball')?.uses).toBeUndefined()
    expect(spells.find((s) => s._id === 'fireball')?.setUses).toBeUndefined()
  })

  it('writes an innate use back to system.location.uses', () => {
    const { npc } = useNpc(actorRef(hag()))
    updateActorItem.mockClear()
    npc.spells.value?.find((s) => s._id === 'dominate')?.setUses?.(2)
    expect(updateActorItem).toHaveBeenCalledWith(expect.anything(), 'dominate', {
      system: { location: { uses: { value: 2 } } }
    })
  })

  it('rolls spell damage at the heightened rank by default', () => {
    const { npc } = useNpc(actorRef(hag()))
    const meta = npc.spells.value?.find((s) => s._id === 'meta')
    meta?.getDamage?.()
    expect(getSpellDamage).toHaveBeenCalledWith(expect.anything(), 'meta', 8, undefined, undefined)
    meta?.doSpellDamage?.(0)
    expect(rollCheck).toHaveBeenCalledWith(
      expect.anything(),
      'spellDamage',
      { spellId: 'meta', mapIncreases: 0, castingRank: 8 },
      {},
      [],
      {}
    )
  })

  it('rolls a spell attack against the spell’s own entry', () => {
    const { npc } = useNpc(actorRef(hag()))
    npc.spells.value?.find((s) => s._id === 'meta')?.doSpellAttack?.(2, 11)
    expect(rollCheck).toHaveBeenCalledWith(
      expect.anything(),
      'spellAttack',
      { entryId: 'innate01', spellId: 'meta', attackNumber: 2 },
      { d20: [11] },
      [],
      {}
    )
  })

  it('keeps slot accounting for a prepared entry', () => {
    const { npc } = useNpc(actorRef(hag()))
    const prep = npc.spellcastingEntries.value?.find((e) => e._id === 'prep01')
    expect(prep?.system.slots?.slot3?.value).toBe(1)
    expect(prep?.system.slots?.slot3?.max).toBe(2)
    updateActorItem.mockClear()
    prep?.setSlotCount?.(3, 0)
    expect(updateActorItem).toHaveBeenCalledWith(expect.anything(), 'prep01', {
      system: { slots: { slot3: { value: 0 } } }
    })
  })

  it('exposes the focus pool for a focus-spell entry', () => {
    const { npc } = useNpc(actorRef(hag()))
    expect(npc.focusPoints.current.value).toBe(1)
    expect(npc.focusPoints.max.value).toBe(2)
  })

  it('reports no spellcasting for a non-caster', () => {
    const { npc } = useNpc(actorRef(wolf()))
    expect(npc.spellcastingEntries.value).toEqual([])
    expect(npc.spells.value).toEqual([])
  })
})

describe('useNpc — unattached spells', () => {
  // A caster with a ritual-style spell whose location was never set, and one
  // pointing at an entry that no longer exists.
  function withOrphans(): TablemateNpc {
    const base = hag() as unknown as { items: Record<string, unknown>[] }
    base.items.push(
      {
        _id: 'weather',
        name: 'Control Weather',
        type: 'spell',
        system: {
          level: { value: 8 },
          location: { value: null },
          traits: { value: [] },
          description: { value: '' }
        }
      },
      {
        _id: 'stale',
        name: 'Stale Spell',
        type: 'spell',
        system: {
          level: { value: 2 },
          location: { value: 'deletedEntry' },
          traits: { value: [] },
          description: { value: '' }
        }
      }
    )
    return base as unknown as TablemateNpc
  }

  it('still exposes them as spells so the sheet can list them', () => {
    const { npc } = useNpc(actorRef(withOrphans()))
    const ids = npc.spells.value?.map((s) => s._id)
    expect(ids).toContain('weather')
    expect(ids).toContain('stale')
  })

  it('omits doSpell — there is no entry for PF2e to cast from', () => {
    const { npc } = useNpc(actorRef(withOrphans()))
    const spells = npc.spells.value ?? []
    expect(spells.find((s) => s._id === 'weather')?.doSpell).toBeUndefined()
    expect(spells.find((s) => s._id === 'stale')?.doSpell).toBeUndefined()
    // An attached spell keeps its cast path.
    expect(spells.find((s) => s._id === 'meta')?.doSpell).toBeTypeOf('function')
  })

  it('keeps damage rolls available, at the spell’s own rank', () => {
    const { npc } = useNpc(actorRef(withOrphans()))
    const weather = npc.spells.value?.find((s) => s._id === 'weather')
    expect(weather?.castRank).toBe(8)
    weather?.getDamage?.()
    expect(getSpellDamage).toHaveBeenCalledWith(
      expect.anything(),
      'weather',
      8,
      undefined,
      undefined
    )
  })

  it('treats them as non-innate, so no uses counter appears', () => {
    const { npc } = useNpc(actorRef(withOrphans()))
    const weather = npc.spells.value?.find((s) => s._id === 'weather')
    expect(weather?.uses).toBeUndefined()
    expect(weather?.setUses).toBeUndefined()
  })
})
