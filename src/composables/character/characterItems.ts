import { computed, type Ref } from 'vue'
import type { Actor, Item as PF2eItem } from '@/types/pf2e-types'
import type { Field, Prop } from './helpers'
import { type Item, makeItem } from './item'
import { useApi } from '../api'
import { inventoryTypes } from '@/utils/constants'

export interface Equipment extends Item {
  toggleInvested?: (newValue?: Prop<boolean>) => void
  changeCarry?: (
    method: Prop<string>,
    hands: Prop<number>,
    container: Prop<string | null>,
    inSlot?: Prop<boolean>
  ) => void
}
export interface SpellcastingEntry extends Item {
  staffCharges: Prop<number>
}
export interface Spell extends Item {
  test?: boolean
}
export interface CharacterItems {
  feats: Field<Item[]>
  effects: Field<Item[]>
  inventory: Field<Equipment[]>
  spellcastingEntries: Field<SpellcastingEntry[]>
  spells: Field<Spell[]>
}

export function useCharacterItems(actor: Ref<Actor | undefined>) {
  const { deleteActorItem, updateActorItem } = useApi()
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
          changeValue: (newValue: number) => {
            const update = { system: { value: { value: newValue } } }
            updateActorItem(actor as Ref<Actor>, i._id, update)
          }
        }))
    ),
    inventory: computed(() =>
      actor.value?.items
        ?.filter((i: PF2eItem) => inventoryTypes.map((t) => t.type).includes(i?.type ?? ''))
        .map((i: PF2eItem) => ({
          ...(makeItem(i) as Equipment),
          toggleInvested: (newValue: boolean = !i?.system?.equipped?.invested) => {
            const update = { system: { equipped: { invested: newValue } } }
            updateActorItem(actor as Ref<Actor>, i?._id, update)
          },
          delete: () => {
            deleteActorItem(actor as Ref<Actor>, i?._id)
          },
          changeValue: (newValue: number) => {
            if (!i?.system?.quantity) return
            i.system.quantity = Math.max(newValue, 0)
            const update = { system: { quantity: Math.max(newValue, 0) } }
            updateActorItem(actor as Ref<Actor>, i?._id, update)
          },
          changeCarry: (
            carryType: Prop<string>,
            handsHeld: Prop<number>,
            containerId: Prop<string | null>,
            inSlot: Prop<boolean> = i?.system?.equipped?.inSlot
          ) => {
            if (!i?.system?.equipped) return
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
            updateActorItem(actor as Ref<Actor>, i?._id, update)
          }
        }))
    ),
    spellcastingEntries: computed(() =>
      actor.value?.items
        ?.filter?.((i: PF2eItem) => i?.type === 'spellcastingEntry')
        ?.map((i: PF2eItem) => ({
          ...(makeItem(i) as Item),
          staffCharges: i?.flags?.['pf2e-dailies']?.staff?.charges
        }))
    ),
    spells: computed(() =>
      actor.value?.items
        ?.filter?.((i: PF2eItem) => i?.type === 'spell)')
        ?.map((i: PF2eItem) => ({
          ...(makeItem(i) as Item)
        }))
    )
  }
}
