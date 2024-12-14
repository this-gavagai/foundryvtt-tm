import type { Maybe } from './helpers'
import type { Roll } from '@/types/foundry-types'
import type { Action as PF2eAction, Item as PF2eItem } from '@/types/pf2e-types'
import { type Modifier, makeModifiers } from './modifier'
import { type Item, makeItem } from './item'
export interface Strike {
  label: Maybe<string>
  slug: Maybe<string>
  item?: Maybe<Item>
  variants: Maybe<{ label: string }[]>
  altUsages: Maybe<Strike>[]
  traits: {
    name: Maybe<string>
    label: Maybe<string>
    description: Maybe<string>
  }[]
  weaponTraits: Maybe<{ name: string; label: string; description: string }[]>
  // tmDamageFormula: Maybe<{ base: string; critical: string; _modifiers: Maybe<Modifier[]> }>
  _modifiers: Maybe<Modifier[]>
  doStrike?: (variant: number, altUsage: number | undefined) => Promise<Roll> | null
  doDamage?: (variant: number, altUsage: number | undefined) => Promise<Roll> | null
  getDamage?: () => Promise<unknown> | null
  setDamageType?: (newType: string) => Promise<unknown> | null
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
    // tmDamageFormula: {
    //   base: root?.tmDamageFormula?.base,
    //   critical: root?.tmDamageFormula?.critical,
    //   _modifiers: makeModifiers(root?.tmDamageFormula?._modifiers)
    // },
    _modifiers: makeModifiers(root?._modifiers)
  }
}
