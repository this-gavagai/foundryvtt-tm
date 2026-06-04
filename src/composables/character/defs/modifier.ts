import type { Maybe } from '@/composables/character/helpers'
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
  // PF2e modifier type (status/circumstance/item/proficiency/ability/untyped/etc).
  // Required client-side for the StatBox stacking simulation that mirrors
  // PF2e's applyStackingRules — same non-untyped type → only one wins.
  type: Maybe<string>
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
    hideIfDisabled: m.hideIfDisabled,
    type: m.type
  }))
}
