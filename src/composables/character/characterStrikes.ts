import { computed, type Ref } from 'vue'
import type {
  Actor,
  Item as PF2eItem,
  Action as PF2eAction,
  ElementalBlasts as PF2eElementalBlasts,
  ElementalBlastConfig as PF2eElementalBlastConfig
} from '@/types/pf2e-types'
import type { Field, WritableField, Maybe } from './helpers'
import type { UpdateEventArgs } from '@/types/foundry-types'
import { type Modifier, makeModifiers } from './modifier'
import { type Item, makeItem } from './item'
import { useApi } from '../api'
import type { RequestResolutionArgs } from '@/types/api-types'

interface BlastOptions {
  element: Maybe<string>
  damageType: Maybe<string>
  isMelee: Maybe<boolean>
}

export interface Strike {
  label: Maybe<string>
  slug: Maybe<string>
  item?: Maybe<Item>
  variants: { label: Maybe<string>; map: Maybe<number>; type: Maybe<'melee' | 'ranged'> }[]
  altUsages: Maybe<Strike>[]
  traits: { name: Maybe<string>; label: Maybe<string>; description: Maybe<string> }[]
  weaponTraits: { name: Maybe<string>; label: Maybe<string>; description: Maybe<string> }[]
  ammunition?: {
    compatible: { id: string; name: string }[]
    selected: { id: string }
  }
  _modifiers: Maybe<Modifier[]>

  getDamage?: (
    altUsage?: number | undefined,
    blastOptions?: BlastOptions
  ) => Promise<RequestResolutionArgs | null>
  doStrike?: (
    variant: number,
    altUsage: number | undefined,
    blastOptions?: BlastOptions | undefined,
    result?: number | undefined
  ) => Promise<RequestResolutionArgs | null>
  doDamage?: (
    variant: number,
    altUsage: number | undefined,
    blastOptions?: BlastOptions
  ) => Promise<RequestResolutionArgs | null>
  setDamageType?: (newType: string) => Promise<UpdateEventArgs | null>
  changeAmmo?: (newId: string | null) => Promise<UpdateEventArgs | null>
}
export function makeStrike(
  root: PF2eAction | undefined,
  item: PF2eItem | undefined
): Strike | undefined {
  if (!root) return undefined
  return {
    label: root?.label,
    slug: root?.slug,
    item: makeItem(item),
    variants: root?.variants.map((v, i) => ({ label: v?.label, map: i, type: undefined })),
    altUsages: root?.altUsages.map((a) => makeStrike(a, a.item)),
    traits: root?.traits?.map((t) => ({
      name: t?.name,
      label: t?.label,
      description: t?.description
    })),
    weaponTraits: root?.weaponTraits?.map((t) => ({
      name: t?.name,
      label: t?.label,
      description: t?.description
    })),
    ammunition: {
      compatible: root?.ammunition?.compatible?.map((c: { id: string; label: string }) => ({
        id: c.id,
        name: c.label
      })),
      selected: { id: root?.ammunition?.selected?.id }
    },
    _modifiers: makeModifiers(root?._modifiers)
  }
}

export interface ElementalBlast extends Strike {
  isBlast: Maybe<boolean>
  blastImg: Maybe<string>
  blastElement: Maybe<string>
  blastRange: { increment: Maybe<number>; max: Maybe<number>; label: Maybe<string> }
  blastDamageTypes: { value: Maybe<string>; label: Maybe<string> }[]
}

export function makeElementalBlasts(root: PF2eElementalBlasts | undefined): ElementalBlast[] {
  if (!root) return []
  return root.configs.map((config: PF2eElementalBlastConfig) => ({
    isBlast: true,
    blastElement: config?.element,
    blastRange: {
      increment: config?.range?.increment,
      max: config?.range?.max,
      label: config?.range?.label
    },
    blastDamageTypes: config?.damageTypes.map((d) => ({ value: d?.value, label: d?.label })),
    blastImg: config?.img,
    label: `Elemental Blast (${config?.element})`,
    slug: undefined,
    item: makeItem(config?.item),
    variants: [
      { label: config?.maps?.melee.map0, map: 0, type: 'melee' },
      { label: config?.maps?.melee.map1, map: 1, type: 'melee' },
      { label: config?.maps?.melee.map2, map: 2, type: 'melee' },
      { label: config?.maps?.ranged.map0, map: 0, type: 'ranged' },
      { label: config?.maps?.ranged.map1, map: 1, type: 'ranged' },
      { label: config?.maps?.ranged.map2, map: 2, type: 'ranged' }
    ],
    altUsages: [],
    traits: [],
    weaponTraits: [],
    _modifiers: makeModifiers(config?.statistic?.modifiers)
  }))
}

export interface CharacterStrikes {
  strikes: Field<Strike[]>
  blasts: Field<ElementalBlast[]>
  blastActions: WritableField<string>
}

export function useCharacterStrikes(actor: Ref<Actor | undefined>): CharacterStrikes {
  const { rollCheck, updateActorItem, getStrikeDamage } = useApi()
  const strikes = computed(() => {
    return actor.value?.system?.actions?.map(
      (action: PF2eAction) =>
        ({
          ...makeStrike(
            action,
            actor.value?.items.find((i: PF2eItem) => i.system?.slug === action?.slug)
          ),
          getDamage: (altUsage = undefined) =>
            getStrikeDamage(actor as Ref<Actor>, action.slug, altUsage),
          doStrike: (variant, altUsage, blastOptions, result) =>
            rollCheck(
              actor as Ref<Actor>,
              'strike',
              `${action.slug},${variant},${altUsage ?? ''}`,
              {
                d20: [result ?? 0]
              }
            ),
          doDamage: (variant, altUsage) =>
            rollCheck(
              actor as Ref<Actor>,
              'damage',
              `${action.slug},${variant ? 'critical' : 'damage'},${altUsage ?? ''}`
            ),
          setDamageType: (newType) => {
            const item = actor.value?.items.find((i: PF2eItem) => i._id === action?.item?._id)
            if (!item || !actor.value) return Promise.resolve(null)
            const adjustment = item?.system?.damage?.damageType === newType ? null : newType
            const isModular = item?.system?.traits?.value?.includes('modular')
            const update = isModular
              ? { system: { traits: { toggles: { modular: { selected: adjustment } } } } }
              : { system: { traits: { toggles: { versatile: { selected: adjustment } } } } }
            if (isModular)
              actor.value.items.find(
                (i: PF2eItem) => i._id === action?.item?._id
              )!.system.traits.toggles.modular.selected = adjustment
            else
              actor.value.items.find(
                (i: PF2eItem) => i._id === action?.item?._id
              )!.system.traits.toggles.versatile.selected = adjustment
            return updateActorItem(actor as Ref<Actor>, action?.item?._id ?? '', update)
          },
          changeAmmo: (newId) => {
            const item = actor.value?.items.find((i: PF2eItem) => i._id === action?.item?._id)
            const actorAction = actor.value?.system.actions.find(
              (a: PF2eAction) => a.slug === action?.slug
            )
            if (item && item.system) item.system.selectedAmmoId = newId
            if (actorAction) actorAction.ammunition.selected = newId ? { id: newId } : null

            const update = { system: { selectedAmmoId: newId || null } }
            return (
              updateActorItem(actor as Ref<Actor>, action?.item?._id ?? '', update) ??
              Promise.resolve(null)
            )
          }
        }) as Strike
    )
  })
  const blasts = computed(() =>
    makeElementalBlasts(actor.value?.elementalBlasts)?.map(
      (blast: ElementalBlast) =>
        ({
          ...blast,
          getDamage: (altUsage, blastOptions) =>
            getStrikeDamage(
              actor as Ref<Actor>,
              `blast:${blastOptions?.element},${blastOptions?.damageType},${blastOptions?.isMelee}`
            ),
          doStrike: (variant, altUsage, blastOptions, result: number | undefined) =>
            rollCheck(
              actor as Ref<Actor>,
              'blast',
              `${blastOptions?.element},${blastOptions?.damageType},${variant},${blastOptions?.isMelee}`,
              { d20: [result ?? 0] }
            ),
          doDamage: (variant, altUsage, blastOptions) =>
            rollCheck(
              actor as Ref<Actor>,
              'blastDamage',
              `${blastOptions?.element},${blastOptions?.damageType},${variant ? 'criticalSuccess' : 'success'},${blastOptions?.isMelee}`
            ),
          setDamageType: (newType) => {
            const dmgs: Record<string, string> = {}
            dmgs[blast?.blastElement ?? ''] = newType
            const update = {
              flags: { pf2e: { damageSelections: dmgs } }
            }
            const flags = blast.item?.flags.pf2e.damageSelections as Record<string, string>
            flags[blast?.blastElement ?? ''] = newType
            return updateActorItem(actor as Ref<Actor>, blast.item?._id ?? '', update)
          }
        }) as ElementalBlast
    )
  )
  const blastActions = computed({
    get: () => {
      const blastItemId = actor.value?.elementalBlasts?.item?._id
      return actor.value?.items
        ?.find((i) => i._id === blastItemId)
        ?.system?.rules?.find((r) => r.option === 'action-cost')?.selection
    },
    set: (newValue) => {
      const blastItemId = actor.value?.elementalBlasts?.item?._id
      const rules = actor.value?.items?.find((i) => i._id === blastItemId)?.system?.rules
      const actionRule = rules?.find((r) => r.option === 'action-cost')
      if (actionRule) actionRule.selection = newValue ?? ''
      const update = { system: { rules: rules } }
      return updateActorItem(actor as Ref<Actor>, blastItemId ?? '', update)
    }
  })

  return {
    strikes,
    blasts,
    blastActions
  }
}
