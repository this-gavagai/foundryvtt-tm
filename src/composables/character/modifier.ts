import type { Prop } from './helpers'
import type { Modifier as PF2eModifier } from '@/types/pf2e-types'

export interface Modifier {
  slug: Prop<string>
  label: Prop<string>
  modifier: Prop<number>
  enabled: Prop<boolean>
  hideIfDisabled: Prop<boolean>
}
export function makeModifiers(set: PF2eModifier[] | undefined): Modifier[] | undefined {
  if (!set) return undefined
  return set?.map((m: PF2eModifier) => ({
    slug: m.slug,
    label: m.label,
    modifier: m.modifier,
    enabled: m.enabled,
    hideIfDisabled: m.hideIfDisabled
  }))
}
