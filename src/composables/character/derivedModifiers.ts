import { i18n } from '@/plugins/i18n'
import type { Modifier } from './defs/modifier'
import type { EngineModifier } from '@/utils/ruleEngine/flatModifiers'

// The engine's modifiers, named the way PF2e names its own.
//
// The engine has no locale — it emits a stable English label beside each slug,
// because a rule engine that localized would need the world's lang files, which
// is the one thing an app working from source data cannot have. So the naming
// happens here, at the point of display, for the handful of entries the engine
// CONSTRUCTS. Everything it reads off a rule element already carries the item's
// own name, which is world data and is left exactly as it is.
//
// The result is a list whose base rows are in the reader's locale and whose item
// rows are in the world's. That mixing is deliberate and it is the honest
// option: the alternative is showing `dex` and `trained` to everyone.

// Slug → i18n key, for the entries statistics.ts builds itself.
const BASE_LABELS: Record<string, string> = {
  str: 'attributesFull.str',
  dex: 'attributesFull.dex',
  con: 'attributesFull.con',
  int: 'attributesFull.int',
  wis: 'attributesFull.wis',
  cha: 'attributesFull.cha',
  // PF2e's own slug for the Constitution contribution to hit points.
  'hp-con': 'attributesFull.con',
  'ancestry-hp': 'hp.ancestryHp',
  'class-hp': 'hp.classHp'
}

// The proficiency row is labelled by RANK — PF2e shows "Trained", not
// "Proficiency" — so the engine puts the rank name in `label` and this maps it.
const RANK_KEYS = new Set(['untrained', 'trained', 'expert', 'master', 'legendary'])

// The GLOBAL i18n instance, not `useI18n()`. These labels are read from
// composables the sheet calls outside a component setup — and characterStats
// already reaches for the same instance a few lines further down, for the same
// reason. `useI18n()` here made useCharacterStats throw unless it happened to be
// constructed inside a component, which is a coupling a data composable should
// not have.
export function useDerivedModifiers() {
  const t = (key: string) => i18n.global.t(key)
  const te = (key: string) => i18n.global.te(key)

  const label = (modifier: EngineModifier): string => {
    const key = BASE_LABELS[modifier.slug ?? '']
    if (key && te(key)) return t(key)
    if (RANK_KEYS.has(modifier.label)) return t(`proficiencyLevels.${modifier.label}`)
    // An item's own name, or a rule element's label: world data, already named.
    return modifier.label
  }

  return {
    present: (modifiers: EngineModifier[] | undefined): Modifier[] | undefined =>
      modifiers?.map((modifier) => ({
        slug: modifier.slug,
        label: label(modifier),
        modifier: modifier.modifier,
        enabled: modifier.enabled,
        hideIfDisabled: modifier.hideIfDisabled,
        type: modifier.type,
        diceNumber: undefined,
        dieSize: undefined,
        damageType: undefined,
        critical: undefined
      }))
  }
}
