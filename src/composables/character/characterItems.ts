import { computed, type Ref } from 'vue'
import type { CharacterPF2e } from '@7h3laughingman/pf2e-types'
import type { ContainerCapacity, TablemateCharacter } from '@/types/character-types'
import type DocumentSocketResponse from '@7h3laughingman/foundry-types/common/abstract/socket.mjs'
import type { Field, Maybe } from './helpers'
import { type PhysicalItem, type PhysicalItemSystem } from './defs/physicalItem'
import { makeEquipment } from './defs/equipmentDef'
import { makeWeapon } from './defs/weapon'
import { makeArmor } from './defs/armor'
import { type Consumable, makeConsumable } from './defs/consumable'
import { type Feat, makeFeat } from './defs/feat'
import { type Effect, makeEffect } from './defs/effect'
import { makeCondition } from './defs/condition'
import { createActorItem, deleteActorItem, updateActorItem } from '@/api/documents'
import { asDocumentArray } from '@/api/internal'
import { attachItem, consumeItem, detachItem } from '@/api/actionRpc'
import { inventoryTypes } from '@/utils/constants'
import { removalLockedBy, type GrantAwareItem } from '@/utils/itemGrants'
import { stackCandidateIds, stackQuantity, type StackableItem } from '@/utils/itemStacks'
import { sourceFromEmbedded, type StoredItem } from '@/utils/itemSource'
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
  system: { uses?: { value: Maybe<number>; max: Maybe<number> }; category?: Maybe<string> }
  consumeItem?: Consumable['consumeItem']
  changeUses?: Consumable['changeUses']
  // Attaches this loose item onto the given parent item (for items with an
  // `attached-to-*` trait, e.g. a shield boss).
  attachTo?: (parentId: string) => ReturnType<typeof attachItem>
  // Detaches this subitem from its parent, restoring it as a standalone item.
  detach?: () => ReturnType<typeof detachItem>
  // Splits `count` off a stack into a second item on the same actor, leaving
  // `quantity - count` behind. Resolves null without writing anything when the
  // count wouldn't divide the stack (outside 1…quantity-1).
  splitStack?: (count: number) => Promise<DocumentSocketResponse | null>
  // The ids of the other stacks this one could absorb, by PF2e's own
  // stackability rule (utils/itemStacks). A method rather than a field: the rule
  // compares two items' whole system data, and only the item whose menu is open
  // needs the answer, so the sweep is paid for when it's asked for.
  stackableIds?: () => string[]
  // Folds the given stacks into this one — this item keeps the combined
  // quantity, the sources are deleted. Ids that aren't stackable with this item
  // are ignored; resolves null when none of them were.
  mergeStack?: (sourceIds: string[]) => Promise<DocumentSocketResponse | null>
  // How full this container is, for `backpack` items — resolved Foundry-side
  // from PF2e's own container getters (see ContainerCapacity). Absent on every
  // other item type, and on module builds predating the field.
  capacity?: ContainerCapacity
}

export type EffectItem = Effect & {
  system: { value?: { value: Maybe<number>; isValued: Maybe<boolean> } }
  // Name of the condition or effect holding this one in place, when something
  // is. Present exactly when `delete` is absent — the sheet renders it as the
  // reason removal isn't on offer. See utils/itemGrants.removalLockedBy.
  lockedBy?: string
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
          !DIVINE_INTERCESSION_CATEGORIES.includes(
            (i as FeatPF2e<CharacterPF2e>)?.system?.category ?? ''
          )
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
        // Whether this one can go on its own is the grant graph's answer, not a
        // rule of thumb — PF2e's own sheet asks the same question via
        // ConditionPF2e#isLocked. A held condition keeps the blocker's NAME so
        // the sheet can say which condition to remove instead.
        const lockedBy = removalLockedBy(items as GrantAwareItem[], i as GrantAwareItem)
        const base =
          i.type === 'condition' ? makeCondition(i as ConditionPF2e<CharacterPF2e>) : makeEffect(i)
        if (lockedBy) return { ...base, lockedBy }
        return {
          ...base,
          delete: () => deleteActorItem(actor, i._id!),
          changeQty: (newValue: number) => {
            const update = { system: { value: { value: newValue } } }
            return updateActorItem(actor, i._id!, update)
          }
        }
      })

    // Derive in-memory conditions from the granting item's slug. All in-memory
    // grants in the PF2e condition pack are unconditional (empty predicates), so
    // a static slug → slugs map is sufficient and works immediately when items
    // arrive via the fast Item.create socket path (before a full refresh).
    const IN_MEMORY_GRANTS: Record<string, readonly string[]> = {
      confused: ['off-guard'],
      encumbered: ['clumsy'],
      grabbed: ['off-guard', 'immobilized'],
      paralyzed: ['off-guard'],
      prone: ['off-guard'],
      restrained: ['off-guard', 'immobilized'],
      unconscious: ['off-guard']
    }
    const storedSlugs = new Set(
      items
        .filter((i) => i.type === 'condition')
        .map((i) => i.system?.slug)
        .filter(Boolean)
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
        const name = slug
          .split('-')
          .map((w) => w[0].toUpperCase() + w.slice(1))
          .join('-')
        derived.push({
          _id: `inmem-${item._id}-${slug}`,
          name,
          type: 'condition',
          img: `systems/pf2e/icons/conditions/${slug}.webp`,
          grantedBy: item._id ?? undefined,
          itemGrants: undefined,
          // Always held: an in-memory grant has no document anywhere to delete.
          // PF2e models this as `system.references.parent`, and its own sheet
          // reads that to lock the condition; here the granting item's name is
          // what the sheet needs, so carry that directly.
          lockedBy: item.name ?? undefined,
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
          i.type === 'feat' &&
          DIVINE_INTERCESSION_CATEGORIES.includes(
            (i as FeatPF2e<CharacterPF2e>)?.system?.category ?? ''
          )
      )
      .map((i) => ({
        ...makeFeat(i),
        delete: () => deleteActorItem(actor, i._id!)
      })) as EffectItem[]

    return [...stored, ...derived, ...divineIntercessions]
  })
  // The stored item documents, as the stackability rule needs to see them: the
  // whole `system` source data rather than the sheet's narrowed model, and a
  // real array (`items` is typed as a Foundry collection but arrives as JSON).
  const storedItems = () => (asDocumentArray(actor.value?.items) ?? []) as StackableItem[]
  // The same documents, for the one other job that needs whole source data:
  // building the payload for a create. A separate accessor rather than a reuse
  // of the above because StoredItem is the stricter shape — it requires the
  // `flags` the sheet's item model hasn't got, which is what stops the
  // projection being cloned by mistake (utils/itemSource.ts).
  const storedItem = (id: string | null | undefined): StoredItem | undefined =>
    id
      ? ((asDocumentArray(actor.value?.items) ?? []) as StoredItem[]).find((d) => d._id === id)
      : undefined

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
        capacity: actor.value?.inventory?.containers?.[i._id!],
        toggleInvested: (newValue: boolean = !i?.system?.equipped?.invested) => {
          const update = { system: { equipped: { invested: newValue } } }
          return updateActorItem(actor, i._id!, update)
        },
        delete: () => deleteActorItem(actor, i._id!),
        changeQty: (newValue: number) => {
          if (i?.system?.quantity === undefined) return Promise.resolve(null)
          i.system.quantity = Math.max(newValue, 0)
          const update = { system: { quantity: Math.max(newValue, 0) } }
          return updateActorItem(actor, i._id!, update)
        },
        splitStack: async (count: number) => {
          const total = i?.system?.quantity
          if (typeof total !== 'number') return null
          const amount = Math.floor(count)
          if (!Number.isFinite(amount) || amount < 1 || amount >= total) return null
          // Built from the stored document rather than from this derived model,
          // so the new stack keeps everything PF2e put on the item (runes,
          // rules, identification, flags) instead of only the fields the sheet
          // reads — and with the display overlays undone, so it doesn't inherit
          // a rune-adjusted level or a modular weapon's currently-selected
          // damage type as its own base data. See utils/itemSource.ts.
          const stored = storedItem(i._id)
          if (!stored) return null
          const copy = sourceFromEmbedded(stored, { quantity: amount })
          // The create goes first and is awaited: the original is only decremented
          // once the new stack exists, so a rejected write can't make the
          // difference disappear. Same ordering rule as a party transfer.
          await createActorItem(actor, [copy])
          i.system.quantity = total - amount
          return updateActorItem(actor, i._id!, { system: { quantity: total - amount } })
        },
        stackableIds: () => stackCandidateIds(storedItems(), i),
        mergeStack: async (sourceIds: string[]) => {
          const total = i?.system?.quantity
          if (typeof total !== 'number') return null
          // Re-checked here rather than trusting the caller's ids: the menu that
          // offered them was built against an older inventory, and merging an
          // item that is no longer stackable is how runes get destroyed.
          const stackable = stackCandidateIds(storedItems(), i)
          const absorbed = storedItems().filter(
            (other) => !!other._id && stackable.includes(other._id) && sourceIds.includes(other._id)
          )
          if (!absorbed.length) return null
          const merged = absorbed.reduce((sum, source) => sum + stackQuantity(source), total)
          // The survivor is credited BEFORE the sources are deleted, which is
          // the opposite of PF2e's own stackWith (it deletes, then updates).
          // Reversed for the same reason the split creates before decrementing:
          // these are separate socket writes with no transaction around them, so
          // the order decides what a failure between them leaves behind — a
          // visible duplicate rather than quantity that no longer exists
          // anywhere. updateActorItem rethrows, so a failed credit stops here.
          i.system.quantity = merged
          await updateActorItem(actor, i._id!, { system: { quantity: merged } })
          return deleteActorItem(
            actor,
            absorbed.map((source) => source._id!)
          )
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
          return updateActorItem(actor, i._id!, update)
        },
        consumeItem: () => consumeItem(actor, i._id!),
        changeUses: (newValue: number) => {
          const updates = { system: { uses: { value: newValue } } }
          return updateActorItem(actor, i._id!, updates)
        },
        attachTo: (parentId: string) => attachItem(actor, i._id!, parentId)
      }))
      .map((e) => {
        ;(e.system as PhysicalItemSystem).subitems?.forEach((s) => {
          const sub = s as InventoryItem
          sub.label = actor.value?.inventory?.labels?.[s?._id ?? '']
          // The owning item `e` is this subitem's parent; detach goes through it.
          sub.detach = () => detachItem(actor, e._id!, s._id!)
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
