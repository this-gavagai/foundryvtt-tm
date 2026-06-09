import { computed, type Ref } from 'vue'
import type { CharacterPF2e } from '@7h3laughingman/pf2e-types'
import type { TablemateCharacter } from '@/types/character-types'
import type { Field, Maybe } from './helpers'
import { type Spell, type SpellcastingEntry, makeSpell, makeSpellcastingEntry } from './defs/spellDef'
import { type Consumable, makeConsumable } from './defs/consumable'
import { castSpell, castStaffSpell, consumeItem, getSpellDamage, rollCheck } from '@/api/actionRpc'
import type { DiceResults } from '@/types/api-types'
import { makeModifiers } from './defs/modifier'
import { updateActor, updateActorItem } from '@/api/documents'
import type DocumentSocketResponse from '@7h3laughingman/foundry-types/common/abstract/socket.mjs'
import type {
  ConsumablePF2e,
  SpellPF2e,
  SpellcastingEntryPF2e,
  SlotKey
} from '@7h3laughingman/pf2e-types'

export type { Spell, SpellcastingEntry }

type StaffData = {
  spells?: SpellPF2e[]
  staffId?: string
  charges?: { value?: number; max?: number }
  expended?: boolean
}
type PF2eDailiesFlags = { extra?: { dailies?: { staves?: StaffData } } } | undefined

function isSpellSource(item: SpellPF2e | null | undefined): item is SpellPF2e {
  return item?.type === 'spell' && !!item.system
}

export interface Staff {
  staffId: Maybe<string>
  charges: {
    value: Maybe<number>
    max: Maybe<number>
  }
  spells: Spell[]
  expended: Maybe<boolean>
  setStaffCharges?: (newValue: number) => Promise<DocumentSocketResponse | null>
}

export interface CharacterSpells {
  spellcastingEntries: Field<SpellcastingEntry[]>
  spells: Field<Spell[]>
  staff: Field<Staff>
  spellConsumables: Field<Consumable[]>
}

export function useCharacterSpells(actor: Ref<TablemateCharacter | undefined>): CharacterSpells {
  const spellcastingEntries = computed(() =>
    actor.value?.items
      ?.filter((i): i is SpellcastingEntryPF2e<CharacterPF2e> => i?.type === 'spellcastingEntry')
      ?.map((item) => {
        const spellModData = item._id ? actor.value?.spellcastingModifiers?.[item._id] : undefined
        return {
          ...makeSpellcastingEntry(item),
          spellAttackModifier: spellModData?.mod,
          spellAttackModifiers: makeModifiers(spellModData?.modifiers),
          doSpellAttack: (result?: number, modifierOverrides?: Record<string, boolean>) =>
            rollCheck(
              actor as Ref<CharacterPF2e>,
              'spellAttack',
              item._id ?? '',
              { d20: [result ?? 0] },
              [],
              modifierOverrides ? { modifierOverrides } : {}
            ),
          setPrepared: (
            rank: number | undefined,
            slot: number | undefined,
            newSpellId: string | null,
            expended: boolean = false
          ) => {
            const prepared = item.system.slots?.[('slot' + rank) as SlotKey]?.prepared
            if (!prepared || rank == null || slot == null) return Promise.resolve(null)
            if (!prepared[slot]) prepared[slot] = { id: null, expended: true }
            prepared[slot].id = newSpellId
            prepared[slot].expended = expended
            const update = { system: { slots: { ['slot' + rank]: { prepared: prepared } } } }
            return updateActorItem(actor as Ref<CharacterPF2e>, item._id!, update)
          },
          setSlotCount: (rank: number, newValue: number) => {
            const update = { system: { slots: { ['slot' + rank]: { value: newValue } } } }
            return updateActorItem(actor as Ref<CharacterPF2e>, item._id!, update)
          }
        }
      })
  )

  const spells = computed(() => {
    const actorSpells = actor.value?.items
      ?.filter((i): i is SpellPF2e<CharacterPF2e> => i?.type === 'spell')
      ?.map((item) => ({
        ...makeSpell(item),
        doSpell: (rank: number | undefined, slot: number | undefined) => {
          if (rank === undefined || slot === undefined) return Promise.resolve(null)
          return castSpell(actor as Ref<CharacterPF2e>, item._id!, rank, slot)
        },
        doSpellAttack: (
          attackNumber: 1 | 2 | 3,
          result?: number,
          modifierOverrides?: Record<string, boolean>
        ) =>
          rollCheck(
            actor as Ref<CharacterPF2e>,
            'spellAttack',
            `${item.system.location?.value ?? ''},${item._id},${attackNumber}`,
            { d20: [result ?? 0] },
            [],
            modifierOverrides ? { modifierOverrides } : {}
          ),
        doSpellDamage: (
          mapIncreases: 0 | 1 | 2 = 0,
          castingRank?: number,
          result?: DiceResults,
          modifierOverrides?: Record<string, boolean>
        ) =>
          rollCheck(
            actor as Ref<CharacterPF2e>,
            'spellDamage',
            `${item._id},${mapIncreases},${castingRank ?? ''}`,
            result ?? {},
            [],
            modifierOverrides ? { modifierOverrides } : {}
          ),
        getDamage: (castingRank?: number, modifierOverrides?: Record<string, boolean>) =>
          getSpellDamage(actor as Ref<CharacterPF2e>, item._id!, castingRank, modifierOverrides)
      }))

    const dailies = actor.value?.flags?.['pf2e-dailies'] as PF2eDailiesFlags
    const staves = dailies?.extra?.dailies?.staves
    const staffSpells = (staves?.spells ?? []).filter(isSpellSource).map((i) => ({
      ...makeSpell(i),
      doSpell: (rank: number | undefined) =>
        castStaffSpell(actor as Ref<CharacterPF2e>, staves!.staffId!, i._id!, rank ?? 1)
    }))

    return [...(actorSpells ?? []), ...staffSpells]
  })

  const spellConsumables = computed(() =>
    actor.value?.items
      ?.filter(
        (i): i is ConsumablePF2e<CharacterPF2e> =>
          i.type === 'consumable' &&
          !!(
            i.system?.traits?.value?.includes('scroll') ||
            i.system?.traits?.value?.includes('wand')
          )
      )
      ?.map((i) => ({
        ...makeConsumable(i),
        consumeItem: () => consumeItem(actor as Ref<CharacterPF2e>, i._id!),
        changeUses: (newValue: number) => {
          const updates = { system: { uses: { value: newValue } } }
          return updateActorItem(actor as Ref<CharacterPF2e>, i._id!, updates)
        }
      }))
  )

  const staff = computed(() => {
    const staffData = (actor.value?.flags?.['pf2e-dailies'] as PF2eDailiesFlags)?.extra?.dailies
      ?.staves
    const staffEntryId = staffData?.staffId ? `${staffData.staffId}-casting` : ''
    return {
      staffId: staffData?.staffId,
      charges: {
        value: staffData?.charges?.value,
        max: staffData?.charges?.max
      },
      spells: (staffData?.spells ?? []).filter(isSpellSource).map((i) => ({
        ...makeSpell(i),
        doSpell: (rank: number | undefined) =>
          castStaffSpell(actor as Ref<CharacterPF2e>, staffData!.staffId!, i._id!, rank ?? 1),
        doSpellAttack: (
          attackNumber: 1 | 2 | 3,
          result?: number,
          modifierOverrides?: Record<string, boolean>
        ) =>
          rollCheck(
            actor as Ref<CharacterPF2e>,
            'spellAttack',
            `${staffEntryId},${i._id},${attackNumber}`,
            { d20: [result ?? 0] },
            [],
            modifierOverrides ? { modifierOverrides } : {}
          ),
        doSpellDamage: (
          mapIncreases: 0 | 1 | 2 = 0,
          castingRank?: number,
          result?: DiceResults,
          modifierOverrides?: Record<string, boolean>
        ) =>
          rollCheck(
            actor as Ref<CharacterPF2e>,
            'spellDamage',
            `${i._id},${mapIncreases},${castingRank ?? ''}`,
            result ?? {},
            [],
            modifierOverrides ? { modifierOverrides } : {}
          ),
        getDamage: (castingRank?: number, modifierOverrides?: Record<string, boolean>) =>
          getSpellDamage(actor as Ref<CharacterPF2e>, i._id!, castingRank, modifierOverrides)
      })),
      expended: staffData?.expended,
      setStaffCharges: (newValue: number) => {
        const update = {
          flags: {
            'pf2e-dailies': { extra: { dailies: { staves: { charges: { value: newValue } } } } }
          }
        }
        return updateActor(actor as Ref<CharacterPF2e>, update)
      }
    }
  })

  return {
    spellcastingEntries,
    spells,
    spellConsumables,
    staff
  }
}
