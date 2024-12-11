import type { Maybe } from './helpers'
import type { Roll } from '@/types/foundry-types'
import type { Stat as PF2eStat, Modifier as PF2eModifier } from '@/types/pf2e-types'
import { type Modifier, makeModifiers } from './modifier'

export interface Stat {
  label: Maybe<string>
  slug: Maybe<string>
  type: Maybe<string>
  breakdown: Maybe<string>
  attribute: Maybe<string>
  rank: Maybe<number>
  total: Maybe<number>
  value: Maybe<number>
  totalModifier: Maybe<number>
  modifiers: Maybe<Modifier[]>
  dc: Maybe<number>
  armor: Maybe<boolean>
  lore: Maybe<boolean>
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
