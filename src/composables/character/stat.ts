import type { Maybe } from './helpers'
import type { BaseStatisticTraceData, RawModifier } from '@7h3laughingman/pf2e-types'
import type { RequestResolutionArgs } from '@/types/api-types'
import { type Modifier, makeModifiers } from './modifier'

import { capitalize } from 'lodash-es'

type StatInput = Partial<Omit<BaseStatisticTraceData, 'modifiers'>> & {
  attribute?: string | null
  rank?: number
  lore?: boolean
  totalModifier?: number
  dc?: number
  modifiers?: unknown[]
}

export interface Stat {
  label: Maybe<string>
  slug: Maybe<string>
  type: Maybe<string>
  breakdown: Maybe<string>
  attribute: Maybe<string>
  rank: Maybe<number>
  value: Maybe<number>
  totalModifier: Maybe<number>
  modifiers: Maybe<Modifier[]>
  dc: Maybe<number>
  lore: Maybe<boolean>
  roll?: (result?: number | undefined, options?: object | undefined) => Promise<RequestResolutionArgs | null>
}
export function makeStat(root: StatInput | undefined, key: string | null = null): Stat | undefined {
  if (!root) return undefined
  return {
    slug: root?.slug ?? key ?? undefined,
    label: root?.label ?? root?.slug ?? capitalize(key ?? ''),
    type: undefined,
    breakdown: root?.breakdown,
    attribute: root?.attribute ?? undefined,
    rank: root?.rank,
    value: root?.value,
    totalModifier: root?.totalModifier,
    dc: root?.dc,
    lore: root?.lore,
    modifiers: makeModifiers(root?.modifiers as RawModifier[])
  }
}
