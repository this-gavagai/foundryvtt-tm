import { computed, type Ref } from 'vue'
import type { CharacterPF2e } from '@7h3laughingman/pf2e-types'
import type { TablemateCharacter } from '@/types/character-types'
import type { Field, Maybe } from './helpers'
import { type PhysicalItem, type PhysicalItemSystem } from './defs/physicalItem'
import { makeEquipment } from './defs/equipmentDef'
import { makeWeapon } from './defs/weapon'
import { makeArmor } from './defs/armor'
import { type Consumable, makeConsumable } from './defs/consumable'
import { type Feat, makeFeat } from './defs/feat'
import { type Effect, makeEffect } from './defs/effect'
import { makeCondition } from './defs/condition'
import { deleteActorItem, updateActorItem } from '@/api/documents'
import { consumeItem } from '@/api/actionRpc'
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
  const DIVINE_INTERCESSION_CATEGORIES = ['deityboon', 'curse']

  const feats = computed(() =>
    actor.value?.items
      ?.filter(
        (i): i is FeatPF2e<CharacterPF2e> =>
          i.type === 'feat' &&
          !DIVINE_INTERCESSION_CATEGORIES.includes(i?.system?.category ?? '')
      )
      .sort(
        (a, b) =>
          (a?.system?.level?.taken ?? a?.system?.level?.value ?? 0) -
          (b?.system?.level?.taken ?? b?.system?.level?.value ?? 0)
      )
      .map((i) => makeFeat(i))
  )
  const effects = computed(() => {
    const items = actor.value ? [...actor.value.items] : []

    const stored = items
      .filter((i): i is AbstractEffectPF2e<CharacterPF2e> =>
        ['effect', 'condition'].includes(i?.type ?? '')
      )
      .map((i) => {
        // Conditions granted by a parent rule element (GrantItem with
        // inMemoryOnly: true) have no persisted ID Foundry can act on.
        // The right action is to remove the parent, not the child.
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

    // Derive in-memory conditions from the granting item's slug. All in-memory
    // grants in the PF2e condition pack are unconditional (empty predicates), so
    // a static slug → slugs map is sufficient and works immediately when items
    // arrive via the fast Item.create socket path (before a full refresh).
    const IN_MEMORY_GRANTS: Record<string, readonly string[]> = {
      confused:    ['off-guard'],
      encumbered:  ['clumsy'],
      grabbed:     ['off-guard', 'immobilized'],
      paralyzed:   ['off-guard'],
      prone:       ['off-guard'],
      restrained:  ['off-guard', 'immobilized'],
      unconscious: ['off-guard'],
    }
    const storedSlugs = new Set(
      items.filter((i) => i.type === 'condition').map((i) => i.system?.slug).filter(Boolean)
    )
    const seenDerivedSlugs = new Set<string>()
    const derived: EffectItem[] = []
    for (const item of items) {
      const granterSlug = item.system?.slug
      if (!granterSlug) continue
      const grants = IN_MEMORY_GRANTS[granterSlug]
      if (!grants) continue
      for (const slug of grants) {
        if (storedSlugs.has(slug) || seenDerivedSlugs.has(slug)) continue
        seenDerivedSlugs.add(slug)
        const name = slug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('-')
        derived.push({
          _id: `inmem-${item._id}-${slug}`,
          name,
          type: 'condition',
          img: `systems/pf2e/icons/conditions/${slug}.webp`,
          grantedBy: item._id ?? undefined,
          itemGrants: undefined,
          system: {
            slug,
            description: { value: '' },
            traits: { rarity: undefined, value: [] },
            level: { value: undefined },
            value: { value: undefined, isValued: false }
          }
        })
      }
    }

    const divineIntercessions = items
      .filter(
        (i): i is FeatPF2e<CharacterPF2e> =>
          i.type === 'feat' && DIVINE_INTERCESSION_CATEGORIES.includes(i?.system?.category ?? '')
      )
      .map((i) => ({
        ...makeFeat(i),
        delete: () => deleteActorItem(actor as Ref<CharacterPF2e>, i._id!),
      })) as EffectItem[]

    return [...stored, ...derived, ...divineIntercessions]
  })
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
