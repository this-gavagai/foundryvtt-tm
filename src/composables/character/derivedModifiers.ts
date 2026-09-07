import { i18n } from '@/plugins/i18n'
import type { Modifier } from './defs/modifier'
import type { EngineModifier } from '@/utils/ruleEngine/flatModifiers'
import type { ConditionalModifier } from '@/utils/ruleEngine/ledger'

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

  // Fields no derived check modifier ever has: the engine derives no damage, so
  // there are no dice and no damage category, and nothing it reads carries a
  // critical flag or an `ignored` marker.
  const blank = {
    ignored: undefined,
    diceNumber: undefined,
    dieSize: undefined,
    damageType: undefined,
    damageCategory: undefined,
    critical: undefined,
    enableOptions: undefined
  }

  return {
    present: (
      modifiers: EngineModifier[] | undefined,
      // Modifiers the engine resolved correctly and whose answer is "not yet":
      // false for a statistic at rest, true under some roll. Appended as
      // DISABLED rows, which is what PF2e's own breakdown does — it keeps a
      // predicate-failed modifier in the list with `enabled: false` — and what
      // the roll path already ships for a conditional action modifier
      // (`enableOptions`, extracted GM-side; see characterSkillActions).
      //
      // Without them the same character had a SHORTER breakdown with no GM than
      // with one, missing exactly the rows a player wants to see, out of a fact
      // the engine had already computed.
      conditional?: ConditionalModifier[] | undefined
    ): Modifier[] | undefined => {
      if (!modifiers && !conditional) return undefined
      return [
        ...(modifiers ?? []).map((modifier) => ({
          slug: modifier.slug,
          label: label(modifier),
          modifier: modifier.modifier,
          enabled: modifier.enabled,
          hideIfDisabled: modifier.hideIfDisabled,
          type: modifier.type,
          force: modifier.force,
          ...blank
        })),
        ...(conditional ?? []).map((entry) => ({
          slug: entry.slug,
          // A conditional's label is a rule element's own, or the item's — world
          // data either way, so it is not mapped through i18n. The one exception
          // an AE-like conditional can produce is a bare path, which is not a
          // label; the item's name is carried for exactly that case.
          label: entry.label || entry.itemName || entry.slug,
          modifier: entry.modifier,
          // Never shown as contributing. `stackingOutcome` reads `enabled` as
          // its liveness input, so a disabled row enters no contest and adds
          // nothing to the total — while a player toggling it on puts it in,
          // exactly as it does for a disabled row PF2e sent.
          enabled: false,
          // Always shown. `hideIfDisabled` exists for a modifier that is noise
          // when off; a conditional is the opposite — being off is the whole
          // thing it has to say.
          hideIfDisabled: false,
          type: entry.type,
          force: false,
          ...blank,
          // The options the predicate is waiting on, where it named them
          // plainly. Toggling such a row DECLARES them for the roll and lets
          // PF2e answer its own predicate, instead of overriding `enabled` on a
          // modifier keyed by a slug the engine reconstructed from a label —
          // which `applyOverridesToModifiers` skips in silence when it does not
          // match PF2e's. See useModifierOverrides.enabledOptions.
          enableOptions: entry.enableOptions
        }))
      ]
    }
  }
}
