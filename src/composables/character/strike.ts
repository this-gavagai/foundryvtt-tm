import type { Prop } from './helpers'
import type { Roll } from '@/types/foundry-types'
import type { Action as PF2eAction, Item as PF2eItem } from '@/types/pf2e-types'
import { type Modifier, makeModifiers } from './modifier'
import { type Item, makeItem } from './item'
export interface Strike {
  label: Prop<string>
  slug: Prop<string>
  item?: Prop<Item>
  variants: Prop<{ label: string }[]>
  traits: {
    name: Prop<string>
    label: Prop<string>
    description: Prop<string>
  }[]
  weaponTraits: Prop<{ name: string; label: string; description: string }[]>
  // tmDamageFormula: Prop<{ base: string; critical: string; _modifiers: Prop<Modifier[]> }>
  _modifiers: Prop<Modifier[]>
  doStrike?: (variant: number) => Promise<Roll> | null
  doDamage?: (variant: number) => Promise<Roll> | null
  getDamage?: () => Promise<unknown> | null
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
    variants: root?.variants.map((v) => ({ label: v?.label })),
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
    // tmDamageFormula: {
    //   base: root?.tmDamageFormula?.base,
    //   critical: root?.tmDamageFormula?.critical,
    //   _modifiers: makeModifiers(root?.tmDamageFormula?._modifiers)
    // },
    _modifiers: makeModifiers(root?._modifiers)
  }
}
