import type { Prop } from './helpers'
import type { Roll } from '@/types/foundry-types'
import type { Stat as PF2eStat, Modifier as PF2eModifier } from '@/types/pf2e-types'
import { type Modifier, makeModifiers } from './modifier'

export interface Stat {
  label: Prop<string>
  slug: Prop<string>
  type: Prop<string>
  breakdown: Prop<string>
  attribute: Prop<string>
  rank: Prop<number>
  total: Prop<number>
  value: Prop<number>
  totalModifier: Prop<number>
  modifiers: Prop<Modifier[]>
  dc: Prop<number>
  armor: Prop<boolean>
  lore: Prop<boolean>
  roll?: () => Promise<Roll> | null
}
export function makeStat(root: PF2eStat | undefined): Stat | undefined {
  if (!root) return undefined
  return {
    slug: root?.slug,
    label: root?.label,
    type: root?.type,
    breakdown: root?.breakdown,
    attribute: root?.attribute,
    rank: root?.rank,
    total: root?.total,
    value: root?.value,
    totalModifier: root?.totalModifier,
    dc: root?.dc,
    armor: root?.armor,
    lore: root?.lore,
    modifiers: makeModifiers(root?.modifiers as PF2eModifier[])
  }
}
