import { computed, type Ref } from 'vue'
import type { CharacterPF2e } from '@7h3laughingman/pf2e-types'
import type { TablemateCharacter } from '@/types/character-types'
import type { Field, Maybe } from './helpers'
import { type PhysicalItem, type PhysicalItemSystem } from './defs/physicalItem'
import { makeEquipment } from './defs/equipment'
import { makeWeapon } from './defs/weapon'
import { makeArmor } from './defs/armor'
import { type Consumable, makeConsumable } from './defs/consumable'
import { type Feat, makeFeat } from './defs/feat'
import { type Effect, makeEffect } from './defs/effect'
import { makeCondition } from './defs/condition'
import { deleteActorItem, updateActorItem } from '@/api/documents'
import { consumeItem } from '@/api/actions'
import { inventoryTypes } from '@/utils/constants'
import type {
  AbstractEffectPF2e,
  ArmorPF2e,
  ConditionPF2e,
  ConsumablePF2e,
  EquipmentPF2e,
  FeatPF2e,
  PhysicalItemPF2e,
  WeaponPF2e
} from '@7h3laughingman/pf2e-types'

export type InventoryItem = PhysicalItem & {
  system: { uses?: { value: Maybe<number>; max: Maybe<number> } }
  consumeItem?: Consumable['consumeItem']
  changeUses?: Consumable['changeUses']
}

export type EffectItem = Effect & {
  system: { value?: { value: Maybe<number>; isValued: Maybe<boolean> } }
}

// export type { PhysicalItem, Weapon, Armor, Consumable, Feat, Effect, Condition }
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

export function useCharacterItems(actor: Ref<TablemateCharacter | undefined>): CharacterItems {
  const feats = computed(() =>
    actor.value?.items
      ?.filter((i): i is FeatPF2e<CharacterPF2e> => i.type === 'feat')
      .sort(
        (a, b) =>
          (a?.system?.level?.taken ?? a?.system?.level?.value ?? 0) -
          (b?.system?.level?.taken ?? b?.system?.level?.value ?? 0)
      )
      .map((i) => makeFeat(i))
  )
  const effects = computed(() =>
    actor.value?.items
      ?.filter((i): i is AbstractEffectPF2e<CharacterPF2e> =>
        ['effect', 'condition'].includes(i?.type ?? '')
      )
      .map((i) => {
        // Items granted by a parent rule element (PF2e GrantItem with
        // inMemoryOnly: true — e.g. Off-Guard / Immobilized under Grabbed)
        // have no persisted ID Foundry can act on. The right action is to
        // remove the parent, not the child, so leave delete/changeQty unset.
        const isGranted = !!i.flags?.pf2e?.grantedBy
        const base =
          i.type === 'condition' ? makeCondition(i as ConditionPF2e<CharacterPF2e>) : makeEffect(i)
        if (isGranted) return base
        return {
          ...base,
          delete: () => deleteActorItem(actor as Ref<CharacterPF2e>, i._id!),
          changeQty: (newValue: number) => {
            const update = { system: { value: { value: newValue } } }
            return updateActorItem(actor as Ref<CharacterPF2e>, i._id!, update)
          }
        }
      })
  )
  const inventory = computed(() =>
    actor.value?.items
      ?.filter((i): i is PhysicalItemPF2e<CharacterPF2e> =>
        inventoryTypes.map((t) => t.type).includes(i?.type ?? '')
      )
      .map((i) => ({
        ...(i.type === 'weapon'
          ? makeWeapon(i as WeaponPF2e<CharacterPF2e>)
          : i.type === 'armor'
            ? makeArmor(i as ArmorPF2e<CharacterPF2e>)
            : i.type === 'consumable'
              ? makeConsumable(i as ConsumablePF2e<CharacterPF2e>)
              : makeEquipment(i as EquipmentPF2e<CharacterPF2e>)),
        label: actor.value?.inventory?.labels?.[i._id!],
        toggleInvested: (newValue: boolean = !i?.system?.equipped?.invested) => {
          const update = { system: { equipped: { invested: newValue } } }
          return updateActorItem(actor as Ref<CharacterPF2e>, i._id!, update)
        },
        delete: () => deleteActorItem(actor as Ref<CharacterPF2e>, i._id!),
        changeQty: (newValue: number) => {
          if (i?.system?.quantity === undefined) return Promise.resolve(null)
          i.system.quantity = Math.max(newValue, 0)
          const update = { system: { quantity: Math.max(newValue, 0) } }
          return updateActorItem(actor as Ref<CharacterPF2e>, i._id!, update)
        },
        changeCarry: (
          carryType: Maybe<string>,
          handsHeld: Maybe<number>,
          containerId: Maybe<string | null>,
          inSlot: Maybe<boolean> = i?.system?.equipped?.inSlot ?? undefined
        ) => {
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
          return updateActorItem(actor as Ref<CharacterPF2e>, i._id!, update)
        },
        consumeItem: () => consumeItem(actor as Ref<CharacterPF2e>, i._id!),
        changeUses: (newValue: number) => {
          const updates = { system: { uses: { value: newValue } } }
          return updateActorItem(actor as Ref<CharacterPF2e>, i._id!, updates)
        }
      }))
      .map((e) => {
        ;(e.system as PhysicalItemSystem).subitems?.forEach((s) => {
          ;(s as { label?: string }).label = actor.value?.inventory?.labels?.[s?._id ?? '']
        })
        return e as InventoryItem
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
