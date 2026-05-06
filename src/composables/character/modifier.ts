import type { Maybe } from './helpers'
import type { RawModifier } from '@7h3laughingman/pf2e-types'

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
export function makeModifiers(set: RawModifier[] | undefined): Modifier[] | undefined {
  if (!set) return undefined
  return set?.map((m) => ({
    slug: m.slug,
    label: m.label,
    modifier: m.modifier,
    diceNumber: undefined,
    dieSize: undefined,
    damageType: m.damageType ?? undefined,
    enabled: m.enabled,
    hideIfDisabled: m.hideIfDisabled
  }))
}
