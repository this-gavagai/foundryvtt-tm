import { computed, type Ref } from 'vue'
import type { Actor, Item as PF2eItem } from '@/types/pf2e-types'
import type { Field, Maybe } from './helpers'
import { type Item, makeItem } from './item'
import { useApi } from '../api'
import { inventoryTypes } from '@/utils/constants'
import type { UpdateEventArgs } from '@/types/foundry-types'

export interface Equipment extends Item {
  toggleInvested?: (newValue?: Maybe<boolean>) => Promise<UpdateEventArgs | null>
  changeCarry?: (
    method: Maybe<string>,
    hands: Maybe<number>,
    container: Maybe<string | null>,
    inSlot?: Maybe<boolean>
  ) => Promise<UpdateEventArgs | null>
}
export interface CharacterItems {
  feats: Field<Item[]>
  effects: Field<Item[]>
  inventory: Field<Equipment[]>
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

export function useCharacterItems(actor: Ref<Actor | undefined>): CharacterItems {
  const { deleteActorItem, updateActorItem, consumeItem } = useApi()

  const feats = computed(() =>
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
  )
  const effects = computed(() =>
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
  )
  const inventory = computed(() =>
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
  )
  const bulk = {
    max: computed(() => actor.value?.inventory?.bulk?.max),
    encumberedAfter: computed(() => actor.value?.inventory?.bulk?.encumberedAfter),
    value: {
      value: computed(() => actor.value?.inventory?.bulk?.value.value),
      light: computed(() => actor.value?.inventory?.bulk?.value.light),
      normal: computed(() => actor.value?.inventory?.bulk?.value.normal)
    }
  }
  return {
    feats,
    effects,
    inventory,
    bulk
  }
}
