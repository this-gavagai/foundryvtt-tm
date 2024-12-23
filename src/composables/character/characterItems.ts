import { computed, type Ref } from 'vue'
import type { Actor, Item as PF2eItem } from '@/types/pf2e-types'
import type { Field, Maybe } from './helpers'
import { type Item, makeItem } from './item'
import { useApi } from '../api'
import { inventoryTypes } from '@/utils/constants'

export interface Equipment extends Item {
  toggleInvested?: (newValue?: Maybe<boolean>) => Promise<unknown>
  changeCarry?: (
    method: Maybe<string>,
    hands: Maybe<number>,
    container: Maybe<string | null>,
    inSlot?: Maybe<boolean>
  ) => Promise<unknown>
}
export interface SpellcastingEntry extends Item {
  staffCharges: Maybe<number>
  setPrepared: (
    rank: number | undefined,
    slot: number | undefined,
    newSpellId: string | null,
    newTotal?: boolean | undefined
  ) => Promise<unknown>
  setSlotCount: (rank: number, newValue: number) => Promise<unknown>
  setCharges: (newValue: number) => Promise<unknown>
}
export interface Spell extends Item {
  doSpell?: (rank: number | undefined, slot: number | undefined) => Promise<unknown>
}
export interface CharacterItems {
  feats: Field<Item[]>
  effects: Field<Item[]>
  inventory: Field<Equipment[]>
  spellcastingEntries: Field<SpellcastingEntry[]>
  spells: Field<Spell[]>
  spellConsumables: Field<Item[]>
  bulk: {
    max: Field<number>
    encumberedAfter: Field<number>
    value: {
      value: Field<number>
      light: Field<number>
      normal: Field<number>
    }
  }
}

export function useCharacterItems(actor: Ref<Actor | undefined>) {
  const { deleteActorItem, updateActorItem, castSpell, consumeItem } = useApi()
  return {
    feats: computed(() =>
      actor.value?.items
        ?.filter((i: PF2eItem) => i.type === 'feat')
        .sort(
          (a, b) =>
            (a?.system?.level?.taken ?? a?.system?.level?.value ?? 0) -
            (b?.system?.level?.taken ?? b?.system?.level?.value ?? 0)
        )
        .map((i: PF2eItem) => ({
          ...(makeItem(i) as Item)
        }))
    ),
    effects: computed(() =>
      actor.value?.items
        ?.filter((i: PF2eItem) => ['effect', 'condition'].includes(i?.type ?? ''))
        .map((i: PF2eItem) => ({
          ...(makeItem(i) as Item),
          delete: () => deleteActorItem(actor as Ref<Actor>, i?._id),
          changeQty: (newValue: number) => {
            const update = { system: { value: { value: newValue } } }
            return updateActorItem(actor as Ref<Actor>, i._id, update)
          }
        }))
    ),
    inventory: computed(() =>
      actor.value?.items
        ?.filter((i: PF2eItem) => inventoryTypes.map((t) => t.type).includes(i?.type ?? ''))
        .map((i: PF2eItem) => ({
          ...(makeItem(i) as Equipment),
          toggleInvested: (newValue: boolean = !i?.system?.equipped?.invested) => {
            console.log('toggle invested!')
            const update = { system: { equipped: { invested: newValue } } }
            return updateActorItem(actor as Ref<Actor>, i?._id, update)
          },
          delete: () => deleteActorItem(actor as Ref<Actor>, i?._id),
          changeQty: (newValue: number) => {
            if (i?.system?.quantity === undefined) return Promise.resolve(null)
            i.system.quantity = Math.max(newValue, 0)
            const update = { system: { quantity: Math.max(newValue, 0) } }
            return updateActorItem(actor as Ref<Actor>, i?._id, update)
          },
          changeCarry: (
            carryType: Maybe<string>,
            handsHeld: Maybe<number>,
            containerId: Maybe<string | null>,
            inSlot: Maybe<boolean> = i?.system?.equipped?.inSlot
          ) => {
            console.log('changing carry!')
            if (!i?.system?.equipped) return Promise.resolve(null)
            i.system.equipped.carryType = carryType
            i.system.equipped.handsHeld = handsHeld
            i.system.equipped.inSlot = inSlot
            i.system.containerId = containerId
            const update = {
              system: {
                containerId: containerId,
                equipped: { carryType, handsHeld, inSlot }
              }
            }
            return updateActorItem(actor as Ref<Actor>, i?._id, update)
          },
          consumeItem: () => consumeItem(actor as Ref<Actor>, i._id),
          changeUses: (newValue: number) => {
            const updates = { system: { uses: { value: newValue } } }
            return updateActorItem(actor as Ref<Actor>, i?._id, updates)
          }
        }))
    ),
    spellcastingEntries: computed(() =>
      actor.value?.items
        ?.filter?.((i: PF2eItem) => i?.type === 'spellcastingEntry')
        ?.map((i: PF2eItem) => ({
          ...(makeItem(i) as Item),
          staffCharges: i?.flags?.['pf2e-dailies']?.staff?.charges,
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
          setCharges: (newValue: number) => {
            return updateActorItem(actor as Ref<Actor>, i._id, {
              flags: { 'pf2e-dailies': { staff: { charges: newValue } } }
            })
          },
          setSlotCount: (rank: number, newValue: number) => {
            const update = { system: { slots: { ['slot' + rank]: { value: newValue } } } }
            return updateActorItem(actor as Ref<Actor>, i?._id, update)
          }
        }))
    ),
    spells: computed(() =>
      actor.value?.items
        ?.filter((i: PF2eItem) => i?.type === 'spell')
        ?.map((i: PF2eItem) => ({
          ...(makeItem(i) as Item),
          doSpell: (rank: number | undefined, slot: number | undefined) => {
            console.log(rank, slot)
            if (rank === undefined || slot === undefined) return Promise.resolve(undefined)
            return castSpell(actor as Ref<Actor>, i._id, rank, slot)
          }
        }))
    ),
    spellConsumables: computed(() =>
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
    ),
    bulk: {
      max: computed(() => actor.value?.inventory?.bulk?.max),
      encumberedAfter: computed(() => actor.value?.inventory?.bulk?.encumberedAfter),
      value: {
        value: computed(() => actor.value?.inventory?.bulk?.value.value),
        light: computed(() => actor.value?.inventory?.bulk?.value.light),
        normal: computed(() => actor.value?.inventory?.bulk?.value.normal)
      }
    }
  }
}
