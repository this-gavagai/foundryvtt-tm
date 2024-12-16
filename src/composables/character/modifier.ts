import type { Maybe } from './helpers'
import type { Modifier as PF2eModifier } from '@/types/pf2e-types'

export interface Modifier {
  slug: Maybe<string>
  label: Maybe<string>
  diceNumber: Maybe<number>
  dieSize: Maybe<string>
  damageType: Maybe<string>
  modifier: Maybe<number>
  enabled: Maybe<boolean>
  hideIfDisabled: Maybe<boolean>
}
export function makeModifiers(set: PF2eModifier[] | undefined): Modifier[] | undefined {
  if (!set) return undefined
  return set?.map((m: PF2eModifier) => ({
    slug: m.slug,
    label: m.label,
    modifier: m.modifier,
    diceNumber: m.diceNumber,
    dieSize: m.dieSize,
    damageType: m.damageType,
    enabled: m.enabled,
    hideIfDisabled: m.hideIfDisabled
  }))
}
