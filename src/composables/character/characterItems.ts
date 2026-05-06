import { computed, type Ref } from 'vue'
import type { Actor } from '@/types/pf2e-types'
import type { Field, Maybe } from './helpers'
import { type PhysicalItem, type PhysicalItemSystem } from './physicalItem'
import { type Equipment, makeEquipment } from './equipment'
import { type Weapon, makeWeapon } from './weapon'
import { type Armor, makeArmor } from './armor'
import { type Consumable, makeConsumable } from './consumable'
import { type Feat, makeFeat } from './feat'
import { type Effect, makeEffect } from './effect'
import { type Condition, makeCondition } from './condition'
import { useApi } from '../api'
import { inventoryTypes } from '@/utils/constants'
import type { ArmorPF2e, ConditionPF2e, ConsumablePF2e, EffectPF2e, EquipmentPF2e, FeatPF2e, ItemPF2e, PhysicalItemPF2e, WeaponPF2e } from '@7h3laughingman/pf2e-types'

export type InventoryItem = PhysicalItem & {
  system: { uses?: { value: Maybe<number>; max: Maybe<number> } }
  consumeItem?: Consumable['consumeItem']
  changeUses?: Consumable['changeUses']
}

export type EffectItem = Effect & {
  system: { value?: { value: Maybe<number>; isValued: Maybe<boolean> } }
}

export type { PhysicalItem, Equipment, Weapon, Armor, Consumable, Feat, Effect, Condition }
export interface CharacterItems {
  feats: Field<Feat[]>
  effects: Field<EffectItem[]>
  inventory: Field<InventoryItem[]>
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
    (actor.value?.items as unknown as FeatPF2e[])
      ?.filter((i) => i.type === 'feat')
      .sort(
        (a, b) =>
          (a?.system?.level?.taken ?? a?.system?.level?.value ?? 0) -
          (b?.system?.level?.taken ?? b?.system?.level?.value ?? 0)
      )
      .map((i) => makeFeat(i))
  )
  const effects = computed(() =>
    (actor.value?.items as unknown as ItemPF2e[])
      ?.filter((i) => ['effect', 'condition'].includes(i?.type ?? ''))
      .map((i) => ({
        ...(i.type === 'condition'
          ? makeCondition(i as ConditionPF2e)
          : makeEffect(i as EffectPF2e)),
        delete: () => deleteActorItem(actor as Ref<Actor>, i._id!),
        changeQty: (newValue: number) => {
          const update = { system: { value: { value: newValue } } }
          return updateActorItem(actor as Ref<Actor>, i._id!, update)
        }
      }))
  )
  const inventory = computed(() =>
    (actor.value?.items as unknown as PhysicalItemPF2e[])
      ?.filter((i) => inventoryTypes.map((t) => t.type).includes(i?.type ?? ''))
      .map((i) => ({
        ...(i.type === 'weapon'
          ? makeWeapon(i as WeaponPF2e)
          : i.type === 'armor'
            ? makeArmor(i as ArmorPF2e)
            : i.type === 'consumable'
              ? makeConsumable(i as ConsumablePF2e)
              : makeEquipment(i as EquipmentPF2e)),
        label: actor.value?.inventory?.labels?.[i._id!],
        toggleInvested: (newValue: boolean = !i?.system?.equipped?.invested) => {
          console.log('toggle invested!')
          const update = { system: { equipped: { invested: newValue } } }
          return updateActorItem(actor as Ref<Actor>, i._id!, update)
        },
        delete: () => deleteActorItem(actor as Ref<Actor>, i._id!),
        changeQty: (newValue: number) => {
          if (i?.system?.quantity === undefined) return Promise.resolve(null)
          i.system.quantity = Math.max(newValue, 0)
          const update = { system: { quantity: Math.max(newValue, 0) } }
          return updateActorItem(actor as Ref<Actor>, i._id!, update)
        },
        changeCarry: (
          carryType: Maybe<string>,
          handsHeld: Maybe<number>,
          containerId: Maybe<string | null>,
          inSlot: Maybe<boolean> = i?.system?.equipped?.inSlot ?? undefined
        ) => {
          console.log('changing carry!')
          if (!i?.system?.equipped) return Promise.resolve(null)
          ;(i.system as PhysicalItemSystem).equipped.carryType = carryType
          ;(i.system as PhysicalItemSystem).equipped.handsHeld = handsHeld
          ;(i.system as PhysicalItemSystem).equipped.inSlot = inSlot
          ;(i.system as PhysicalItemSystem).containerId = containerId ?? undefined
          const update = {
            system: {
              containerId: containerId,
              equipped: { carryType, handsHeld, inSlot }
            }
          }
          return updateActorItem(actor as Ref<Actor>, i._id!, update)
        },
        consumeItem: () => consumeItem(actor as Ref<Actor>, i._id!),
        changeUses: (newValue: number) => {
          const updates = { system: { uses: { value: newValue } } }
          return updateActorItem(actor as Ref<Actor>, i._id!, updates)
        }
      }))
      .map((e: PhysicalItem) => {
        e.system.subitems?.forEach((s) => {
          ;(s as PhysicalItem).label = actor.value?.inventory?.labels?.[s?._id ?? '']
        })
        return e
      })
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
