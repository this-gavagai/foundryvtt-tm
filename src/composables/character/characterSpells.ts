import { computed, type Ref } from 'vue'
import type { Actor } from '@/types/pf2e-types'
import type { Field, Maybe } from './helpers'
import { type Item, makeItem } from './item'
import { type Spell, type SpellcastingEntry, makeSpell, makeSpellcastingEntry } from './spell'
import { useApi } from '../api'
import type DocumentSocketResponse from '@7h3laughingman/foundry-types/common/abstract/socket.mjs'
import type { RequestResolutionArgs } from '@/types/api-types'
import type { SpellPF2e, SpellcastingEntryPF2e, SlotKey } from '@7h3laughingman/pf2e-types'

export type { Spell, SpellcastingEntry }

export interface Staff {
  staffId: Maybe<string>
  charges: {
    value: Maybe<number>
    max: Maybe<number>
  }
  spells: Spell[]
  expended: Maybe<boolean>
  setStaffCharges?: (newValue: number) => Promise<DocumentSocketResponse | null>
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
      ?.filter?.((i) => i?.type === 'spellcastingEntry')
      ?.map((item) => {
        const typedItem = item as unknown as SpellcastingEntryPF2e
        return {
          ...makeSpellcastingEntry(typedItem),
          setPrepared: (
            rank: number | undefined,
            slot: number | undefined,
            newSpellId: string | null,
            expended: boolean = false
          ) => {
            const prepared = typedItem.system.slots[('slot' + rank) as SlotKey]?.prepared
            if (!prepared || !rank || !slot) return Promise.resolve(null)
            if (!prepared[slot]) prepared[slot] = { id: null, expended: true }
            prepared[slot].id = newSpellId
            prepared[slot].expended = expended
            const update = { system: { slots: { ['slot' + rank]: { prepared: prepared } } } }
            return updateActorItem(actor as Ref<Actor>, item._id, update)
          },
          setSlotCount: (rank: number, newValue: number) => {
            const update = { system: { slots: { ['slot' + rank]: { value: newValue } } } }
            return updateActorItem(actor as Ref<Actor>, item._id, update)
          }
        }
      })
  )

  const spells = computed(() => {
    const actorSpells = actor.value?.items
      ?.filter((i) => i?.type === 'spell')
      ?.map((item) => ({
        ...makeSpell(item as unknown as SpellPF2e),
        doSpell: (rank: number | undefined, slot: number | undefined) => {
          if (rank === undefined || slot === undefined) return Promise.resolve(null)
          return castSpell(actor as Ref<Actor>, item._id, rank, slot)
        }
      }))

    const staffSpells = (
      actor.value?.flags?.['pf2e-dailies']?.extra?.staffData?.spells ?? []
    ).map((i: unknown) => ({
      ...makeSpell(i as unknown as SpellPF2e),
      doSpell: undefined
    }))

    return [...(actorSpells ?? []), ...staffSpells]
  })

  const spellConsumables = computed(() =>
    actor.value?.items
      ?.filter(
        (i) =>
          i.system?.traits.value?.includes('scroll') || i.system?.traits.value?.includes('wand')
      )
      ?.map((i) => ({
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
    spells: (actor.value?.flags?.['pf2e-dailies']?.extra?.staffData?.spells ?? []).map(
      (i: unknown) => makeSpell(i as unknown as SpellPF2e)
    ),
    expended: actor.value?.flags?.['pf2e-dailies']?.extra?.staffData?.expended,
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
