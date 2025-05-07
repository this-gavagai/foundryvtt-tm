import { computed, type Ref } from 'vue'
import type { Actor, Item as PF2eItem } from '@/types/pf2e-types'
import type { Field, Maybe } from './helpers'
import { type Item, makeItem } from './item'
import { useApi } from '../api'
import type { DocumentEventArgs, UpdateEventArgs } from '@/types/foundry-types'
import type { RequestResolutionArgs } from '@/types/api-types'

export interface SpellcastingEntry extends Item {
  setPrepared: (
    rank: number | undefined,
    slot: number | undefined,
    newSpellId: string | null,
    newTotal?: boolean | undefined
  ) => Promise<UpdateEventArgs | null>
  setSlotCount?: (rank: number, newValue: number) => Promise<UpdateEventArgs>
}
export interface Spell extends Item {
  doSpell?: (
    rank: number | undefined,
    slot: number | undefined
  ) => Promise<RequestResolutionArgs | null>
}
export interface Staff {
  staffId: Maybe<string>
  charges: {
    value: Maybe<number>
    max: Maybe<number>
  }
  spells: Spell[]
  expended: Maybe<boolean>
  setStaffCharges?: (newValue: number) => Promise<DocumentEventArgs | null>
  doStaffSpell?: (
    rank: number | undefined,
    slot: number | undefined,
    spellId: string | undefined
  ) => Promise<RequestResolutionArgs | null>
}

export interface CharacterSpells {
  spellcastingEntries: Field<SpellcastingEntry[]>
  spells: Field<Spell[]>
  staff: Field<Staff>
  spellConsumables: Field<Item[]>
}

export function useCharacterSpells(actor: Ref<Actor | undefined>): CharacterSpells {
  const { updateActor, castSpell, updateActorItem, consumeItem } = useApi()

  const spellcastingEntries = computed(() =>
    actor.value?.items
      ?.filter?.((i: PF2eItem) => i?.type === 'spellcastingEntry')
      ?.map((i: PF2eItem) => ({
        ...(makeItem(i) as Item),
        setPrepared: (
          rank: number | undefined,
          slot: number | undefined,
          newSpellId: string | null,
          expended: boolean = false
        ) => {
          const prepared = i?.system?.slots?.['slot' + rank]?.prepared
          if (!prepared || !rank || !slot) return Promise.resolve(null)
          if (!prepared[slot]) prepared[slot] = { id: null, expended: true }
          prepared[slot].id = newSpellId
          prepared[slot].expended = expended
          const update = { system: { slots: { ['slot' + rank]: { prepared: prepared } } } }
          return updateActorItem(actor as Ref<Actor>, i._id, update)
        },
        // setCharges: (newValue: number) => {
        //   return updateActorItem(actor as Ref<Actor>, i._id, {
        //     flags: { 'pf2e-dailies': { staff: { charges: newValue } } }
        //   })
        // },
        setSlotCount: (rank: number, newValue: number) => {
          const update = { system: { slots: { ['slot' + rank]: { value: newValue } } } }
          return updateActorItem(actor as Ref<Actor>, i?._id, update)
        }
      }))
  )
  const spells = computed(() =>
    actor.value?.items
      ?.filter((i: PF2eItem) => i?.type === 'spell')
      ?.concat(actor.value?.flags?.['pf2e-dailies']?.extra?.staffData?.spells ?? [])
      ?.map((i: PF2eItem) => ({
        ...(makeItem(i) as Item),
        doSpell: (rank: number | undefined, slot: number | undefined) => {
          if (rank === undefined || slot === undefined) return Promise.resolve(null)
          return castSpell(actor as Ref<Actor>, i._id, rank, slot)
        }
      }))
  )
  const spellConsumables = computed(() =>
    actor.value?.items
      ?.filter(
        (i: PF2eItem) =>
          i.system?.traits.value?.includes('scroll') || i.system?.traits.value?.includes('wand')
      )
      ?.map((i: PF2eItem) => ({
        ...(makeItem(i) as Item),
        consumeItem: () => consumeItem(actor as Ref<Actor>, i._id),
        changeUses: (newValue: number) => {
          const updates = { system: { uses: { value: newValue } } }
          return updateActorItem(actor as Ref<Actor>, i?._id, updates)
        }
      }))
  )
  const staff = computed(() => ({
    staffId: actor.value?.flags?.['pf2e-dailies']?.extra?.staffData?.staffId,
    charges: {
      value: actor.value?.flags?.['pf2e-dailies']?.extra?.staffData?.charges?.value,
      max: actor.value?.flags?.['pf2e-dailies']?.extra?.staffData?.charges?.max
    },
    spells: actor.value?.flags?.['pf2e-dailies']?.extra?.staffData?.spells.map((i: PF2eItem) =>
      makeItem(i)
    ),
    expended: actor.value?.flags?.['pf2e-dailies']?.extra?.staffData?.expended,
    // doStaffSpell: () => {},
    setStaffCharges: (newValue: number) => {
      const update = {
        flags: { 'pf2e-dailies': { extra: { staffData: { charges: { value: newValue } } } } }
      }
      return updateActor(actor as Ref<Actor>, update)
    }
  }))

  return {
    spellcastingEntries,
    spells,
    spellConsumables,
    staff
  }
}
