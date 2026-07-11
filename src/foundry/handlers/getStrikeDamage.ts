import type { DamageType, EffectTrait } from '@7h3laughingman/pf2e-types'
import type { GetStrikeDamageArgs } from '@/types/api-types'
import { withBackgroundRoll } from '../backgroundRoll'
import { getCharacter, getGame, makeAck, makeFakeEvent } from '../utils/foundry'
import type { StrikeActionRuntime } from '../utils/strikeRuntime'
import { blastDamageQueryOf } from './checks/subtype'
import {
  withDamageModifierOverrides,
  discoverDamageDicePrototype,
  type ModifierOverrideMap
} from './checks/modifierOverrides'

export async function foundryGetStrikeDamage(args: GetStrikeDamageArgs) {
  const source = getGame()
  const actor = getCharacter(source, args.characterId)
  const target =
    args.targets.map((t: string) => source.scenes.active?.tokens.get(t))?.[0]?.object ?? null

  const blastQuery = blastDamageQueryOf(args)

  const overrides = (args as { modifierOverrides?: ModifierOverrideMap }).modifierOverrides

  const results = await withBackgroundRoll(undefined, () => {
    let damage: Promise<unknown> | null
    let critical: Promise<unknown> | null
    let modifiers: Promise<unknown> | null

    if (blastQuery) {
      const blast = new game.pf2e.ElementalBlast(actor)
      type BlastParams = Parameters<typeof blast.damage>[0]
      const blastBase: BlastParams = {
        element: blastQuery.element as EffectTrait,
        damageType: blastQuery.damageType as DamageType,
        melee: blastQuery.isMelee,
        getFormula: true,
        target
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
      const baseDamageOptions = { getFormula: true, target }
      const baseModifierOptions = {
        context: { rollMode: 'blindroll' },
        rollMode: 'blindroll',
        createMessage: false,
        skipDialog: true,
        event: makeFakeEvent(source),
        target
      }
      const baseStrike = actor.system.actions.find((a) => a.slug === args.actionSlug) as
        | StrikeActionRuntime
        | undefined
      const strike =
        args.altUsage !== undefined ? baseStrike?.altUsages?.[args.altUsage] : baseStrike
      const doesDmg = strike?.item?.dealsDamage ?? false
      damage =
        doesDmg && strike
          ? withDamageModifierOverrides(overrides, () => strike.damage(baseDamageOptions))
          : null
      critical =
        doesDmg && strike
          ? withDamageModifierOverrides(overrides, () => strike.critical(baseDamageOptions))
          : null
      modifiers = doesDmg && strike ? strike.damage(baseModifierOptions) : null
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

  return {
    ...makeAck(args),
    response: {
      damage: results[0],
      critical: results[1],
      modifiers: extractedModifiers
    }
  }
}
