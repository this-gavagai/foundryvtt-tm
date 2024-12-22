import type { Maybe } from './helpers'
import type {
  Action as PF2eAction,
  Item as PF2eItem,
  ElementalBlasts as PF2eElementalBlasts,
  ElementalBlastConfig as PF2eElementalBlastConfig
} from '@/types/pf2e-types'
import { type Modifier, makeModifiers } from './modifier'
import { type Item, makeItem } from './item'

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
    blastOptions?: { element: string; damageType: string; isMelee: boolean }
  ) => Promise<unknown> | null
  doStrike?: (
    variant: number,
    altUsage: number | undefined,
    blastOptions?: { element: string; damageType: string; isMelee: boolean } | undefined,
    result?: number | undefined
  ) => Promise<unknown>
  doDamage?: (
    variant: number,
    altUsage: number | undefined,
    blastOptions?: { element: string; damageType: string; isMelee: boolean }
  ) => Promise<unknown>
  setDamageType?: (newType: string) => Promise<unknown> | null
  changeAmmo?: (newId: string | null) => Promise<unknown> | undefined
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
