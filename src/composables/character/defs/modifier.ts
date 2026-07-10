import type { Maybe } from '@/composables/character/helpers'
import type { RawDamageDice, RawModifier } from '@7h3laughingman/pf2e-types'
import type { SerializedModifier } from '@/types/character-types'

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
  // true = only applies on a critical hit; false = never applies on a critical
  // hit; null/undefined = applies to both. Set by PF2e's FlatModifier and
  // DamageDicePF2e constructors and preserved through JSON serialization.
  critical: Maybe<boolean>
}
type RawDamageModifier = RawModifier | RawDamageDice
// Accept both live PF2e modifiers (world data that never left Foundry) and the
// trimmed SerializedModifier shape that statistics arrive as over the wire.
type ModifierLike = RawDamageModifier | SerializedModifier

export function makeModifiers(set: ModifierLike[] | undefined): Modifier[] | undefined {
  if (!set) return undefined
  return set?.map((m) => ({
    slug: m.slug,
    label: m.label,
    modifier: 'modifier' in m ? m.modifier : undefined,
    diceNumber: 'diceNumber' in m ? m.diceNumber : undefined,
    dieSize: 'dieSize' in m ? (m.dieSize ?? undefined) : undefined,
    damageType: 'damageType' in m ? (m.damageType ?? undefined) : undefined,
    enabled: m.enabled,
    hideIfDisabled: m.hideIfDisabled,
    type: 'type' in m ? m.type : undefined,
    critical: (m as { critical?: boolean | null }).critical ?? undefined
  }))
}
