import { computed, type Ref } from 'vue'
import type { Actor } from '@/types/pf2e-types'
import type { Field, WritableField, Maybe } from './helpers'
import type DocumentSocketResponse from '@7h3laughingman/foundry-types/common/abstract/socket.mjs'
import { type Modifier, makeModifiers } from './modifier'
import { makeItem } from './item'
import { type Weapon, makeWeapon } from './weapon'
import { useApi } from '../api'
import type { RequestResolutionArgs } from '@/types/api-types'
import type {
  CharacterStrike,
  ElementalBlast as PF2eElementalBlast,
  ElementalBlastConfig,
  WeaponPF2e
} from '@7h3laughingman/pf2e-types'

interface BlastOptions {
  element: Maybe<string>
  damageType: Maybe<string>
  isMelee: Maybe<boolean>
}

export interface Strike {
  label: Maybe<string>
  slug: Maybe<string>
  item?: Maybe<Weapon>
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
  setDamageType?: (newType: string) => Promise<DocumentSocketResponse | null>
  changeAmmo?: (newId: string | null) => Promise<DocumentSocketResponse | null>
}

export function makeStrike(
  root: CharacterStrike | undefined,
  item: WeaponPF2e | undefined
): Strike | undefined {
  if (!root) return undefined
  return {
    label: root?.label,
    slug: root?.slug,
    item: item ? makeWeapon(item) : undefined,
    variants: root?.variants.map((v, i) => ({ label: v?.label, map: i, type: undefined })),
    altUsages: root?.altUsages?.map((a) => makeStrike(a as CharacterStrike, a.item)),
    traits: root?.traits?.map((t) => ({
      name: t?.name,
      label: t?.label,
      description: t?.description ?? undefined
    })),
    weaponTraits: root?.weaponTraits?.map((t) => ({
      name: t?.name,
      label: t?.label,
      description: t?.description ?? undefined
    })),
    ammunition: {
      compatible:
        root?.ammunition?.compatible?.map((c: { id: string; label: string }) => ({
          id: c.id,
          name: c.label
        })) ?? [],
      selected: { id: root?.ammunition?.selected?.id ?? '' }
    },
    _modifiers: makeModifiers(root?.modifiers as unknown as Parameters<typeof makeModifiers>[0])
  }
}

export interface ElementalBlast extends Strike {
  isBlast: Maybe<boolean>
  blastImg: Maybe<string>
  blastElement: Maybe<string>
  blastRange: { increment: Maybe<number>; max: Maybe<number>; label: Maybe<string> }
  blastDamageTypes: { value: Maybe<string>; label: Maybe<string> }[]
  damageSelections: Record<string, Maybe<string>>
}

export function makeElementalBlasts(root: PF2eElementalBlast | undefined): ElementalBlast[] {
  if (!root) return []
  return root.configs.map((config: ElementalBlastConfig) => ({
    isBlast: true,
    blastElement: config?.element,
    blastRange: {
      increment: config?.range?.increment ?? undefined,
      max: config?.range?.max ?? undefined,
      label: config?.range?.label
    },
    blastDamageTypes: config?.damageTypes.map((d) => ({ value: d?.value, label: d?.label })),
    blastImg: config?.img,
    damageSelections: {
      ...((config?.item?.flags?.pf2e?.damageSelections as Record<string, string> | undefined) ?? {})
    },
    label: `Elemental Blast (${config?.element})`,
    slug: undefined,
    item: makeItem(config?.item) as Weapon,
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
    _modifiers: makeModifiers(
      config?.statistic?.modifiers as unknown as Parameters<typeof makeModifiers>[0]
    )
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
      (action: CharacterStrike) =>
        ({
          ...makeStrike(
            action,
            actor.value?.items.find((i) => i.system?.slug === action?.slug) as
              | WeaponPF2e
              | undefined
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
            const item = actor.value?.items.find((i) => i._id === action?.item?._id)
            if (!item || !actor.value) return Promise.resolve(null)
            const adjustment = item?.system?.damage?.damageType === newType ? null : newType
            const isModular = item?.system?.traits?.value?.includes('modular')
            const update = isModular
              ? { system: { traits: { toggles: { modular: { selected: adjustment } } } } }
              : { system: { traits: { toggles: { versatile: { selected: adjustment } } } } }
            if (isModular)
              actor.value.items.find(
                (i) => i._id === action?.item?._id
              )!.system.traits.toggles.modular.selected = adjustment
            else
              actor.value.items.find(
                (i) => i._id === action?.item?._id
              )!.system.traits.toggles.versatile.selected = adjustment
            return updateActorItem(actor as Ref<Actor>, action?.item?._id ?? '', update)
          },
          changeAmmo: (newId) => {
            const item = actor.value?.items.find((i) => i._id === action?.item?._id)
            const actorAction = actor.value?.system.actions.find(
              (a: CharacterStrike) => a.slug === action?.slug
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
    makeElementalBlasts(
      actor.value?.elementalBlasts as unknown as PF2eElementalBlast | undefined
    )?.map(
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
            const update = { flags: { pf2e: { damageSelections: dmgs } } }
            blast.damageSelections[blast?.blastElement ?? ''] = newType
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
