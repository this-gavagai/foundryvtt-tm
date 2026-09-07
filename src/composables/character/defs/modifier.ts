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
  // Inputs to the stacking contest the sheet re-runs on every toggle. See
  // ruleEngine/flatModifiers.resolveModifierList.
  force: Maybe<boolean>
  ignored: Maybe<boolean>
  // 'persistent' | 'precision' | 'splash'. Persistent damage is its own stacking
  // pool in PF2e's damage dialog, so this decides which contest a damage
  // modifier enters — without it a persistent status bonus and an ordinary one
  // outranked each other in the panel and both applied in the roll.
  //
  // Two spellings on the wire: `Modifier` carries `damageCategory` as a field
  // and `category` only as a prototype getter (which JSON drops), while
  // `DamageDicePF2e` carries `category` as the field. Read both, store one.
  damageCategory: Maybe<string>
  // The roll option(s) that switch this modifier on, where its predicate names
  // them plainly — lifted GM-side for a skill action's own modifiers, and by the
  // rule engine for a conditional it resolved.
  //
  // Their presence is the whole distinction the panel needs: a row with them is
  // switched on by DECLARING the condition and letting PF2e answer its own
  // predicate, which binds reliably where an override keyed by a reconstructed
  // slug may not. `fromAction` is not carried — it says where the row came from,
  // and nothing here needs to know that.
  enableOptions: Maybe<string[]>
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
    critical: (m as { critical?: boolean | null }).critical ?? undefined,
    force: (m as { force?: boolean }).force ?? undefined,
    ignored: (m as { ignored?: boolean }).ignored ?? undefined,
    damageCategory:
      (m as { damageCategory?: string | null }).damageCategory ??
      (m as { category?: string | null }).category ??
      undefined,
    enableOptions: (m as { enableOptions?: string[] }).enableOptions ?? undefined
  }))
}
