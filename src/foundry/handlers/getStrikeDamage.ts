import type { DamageType, EffectTrait } from '@7h3laughingman/pf2e-types'
import type { GetStrikeDamageArgs, StrikeDamagePreview } from '@/types/api-types'
import { withBackgroundRoll } from '../backgroundRoll'
import { getCharacter, getGame, makeAck, makeFakeEvent } from '../utils/foundry'
import { findStrikeAction } from '../utils/strikeRuntime'
import { blastDamageQueryOf } from './checks/subtype'
import {
  withDamageModifierOverrides,
  discoverDamageDicePrototype,
  type ModifierOverrideMap
} from './checks/modifierOverrides'

export async function foundryGetStrikeDamage(args: GetStrikeDamageArgs) {
  const source = getGame()
  const actor = getCharacter(source, args.characterId)
  // No target, by design: a damage preview describes the weapon, not a victim,
  // so it must not shift as the mirrored target changes.
  //
  // The formula calls below were already target-blind — PF2e builds their roll
  // context with `viewOnly: params.getFormula ?? false`, and viewOnly nulls the
  // target actor outright. Only the modifiers call (which can't pass getFormula:
  // it needs the full damage object, not a formula string) ever saw a target.
  //
  // Caveat worth knowing: PF2e documents `target` as "pulled from
  // game.users.targets if not provided", so that one call now falls back to
  // whatever the handling GM has selected. That is not the player's target and
  // never was reliable, but it is not literally "no target" either — closing it
  // needs a stand-in token PF2e will accept, which is not worth the fragility
  // for a breakdown panel.

  const blastQuery = blastDamageQueryOf(args)

  const overrides = (args as { modifierOverrides?: ModifierOverrideMap }).modifierOverrides

  const results = await withBackgroundRoll(undefined, () => {
    let damage: Promise<unknown> | null
    let critical: Promise<unknown> | null
    let modifiers: Promise<unknown> | null

    if (blastQuery) {
      // Impulses are a kineticist class feature: only a character has one.
      if (!actor.isOfType('character')) {
        throw new Error(`${actor.name} is not a character and has no elemental blast`)
      }
      const blast = new source.pf2e.ElementalBlast(actor)
      type BlastParams = Parameters<typeof blast.damage>[0]
      const blastBase: BlastParams = {
        element: blastQuery.element as EffectTrait,
        damageType: blastQuery.damageType as DamageType,
        melee: blastQuery.isMelee,
        getFormula: true
      }
      // Capture numeric Modifier instances encountered during the formula call as
      // a side effect of the hooked Modifier.prototype.test. Blast dice can't be
      // captured here (DamageDicePF2e.test() and applyAlterations() are not called
      // for blast dice during getFormula), but all numeric bonuses/penalties are.
      const blastCapture = new Set<unknown>()
      const blastDamage = withDamageModifierOverrides(
        overrides,
        () => blast.damage(blastBase),
        blastCapture
      )
      damage = blastDamage
      critical = withDamageModifierOverrides(overrides, () =>
        blast.damage({ ...blastBase, outcome: 'criticalSuccess' })
      )
      // Deduplicate by slug: extractModifiers can produce multiple instances of
      // the same logical modifier when a rule element is registered under more
      // than one of the blast's damage selectors. Prefer the enabled instance;
      // if tied, keep the first seen.
      modifiers = blastDamage.then(() => {
        const bySlug = new Map<string, unknown>()
        for (const m of blastCapture) {
          const slug = (m as { slug?: string }).slug
          if (!slug) continue
          const existing = bySlug.get(slug)
          if (!existing || !(existing as { enabled?: boolean }).enabled) bySlug.set(slug, m)
        }
        return [...bySlug.values()]
      })
    } else {
      const baseDamageOptions = { getFormula: true }
      const baseModifierOptions = {
        context: { rollMode: 'blindroll' },
        rollMode: 'blindroll',
        createMessage: false,
        skipDialog: true,
        event: makeFakeEvent(source)
      }
      const strike = findStrikeAction(actor, {
        actionSlug: args.actionSlug,
        altUsage: args.altUsage,
        itemId: args.itemId,
        usage: args.usage
      })
      // PF2e leaves `damage`/`critical` off a strike that rolls no damage, so
      // `dealsDamage` and the functions being present are the same condition
      // twice; check both rather than trusting them to agree.
      const doesDmg = (strike?.item?.dealsDamage ?? false) && !!strike?.damage
      damage =
        doesDmg && strike?.damage
          ? withDamageModifierOverrides(overrides, () => strike.damage!(baseDamageOptions))
          : null
      critical =
        doesDmg && strike?.critical
          ? withDamageModifierOverrides(overrides, () => strike.critical!(baseDamageOptions))
          : null
      modifiers = doesDmg && strike?.damage ? strike.damage(baseModifierOptions) : null
    }

    return Promise.all([damage, critical, modifiers])
  })

  type DamageModifiers = { options?: { damage?: { modifiers?: unknown[] } } }
  let extractedModifiers: unknown[] | undefined
  if (blastQuery) {
    // modifiers resolved to [...blastCapture] — already a plain array.
    extractedModifiers = results[2] as unknown[] | undefined
  } else {
    const rawModifiers = (results[2] as DamageModifiers | null)?.options?.damage?.modifiers
    // Lazily discover DamageDicePF2e prototype from the mixed modifiers array
    // so subsequent override calls can hook applyAlterations on dice instances.
    discoverDamageDicePrototype(rawModifiers ?? [])
    extractedModifiers = rawModifiers
  }

  // Typed local so the wire contract's field names/arity stay
  // compiler-checked; the values come off PF2e's untyped damage results, so
  // each leaf is asserted.
  const response: StrikeDamagePreview = {
    damage: results[0] as string | undefined,
    critical: results[1] as string | undefined,
    modifiers: extractedModifiers as StrikeDamagePreview['modifiers']
  }
  return { ...makeAck(args), response }
}
