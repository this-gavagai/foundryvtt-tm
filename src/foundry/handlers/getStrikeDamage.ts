import type { DamageType, EffectTrait } from '@7h3laughingman/pf2e-types'
import type { GetStrikeDamageArgs } from '@/types/api-types'
import { useBackgroundRoll } from '../backgroundRoll'
import { getCharacter, getGame, makeAck, makeFakeEvent } from '../utils/foundry'
import type { StrikeActionRuntime } from '../utils/strike'

export async function foundryGetStrikeDamage(args: GetStrikeDamageArgs) {
  const source = getGame()
  const actor = getCharacter(source, args.characterId)
  const target =
    args.targets.map((t: string) => source.scenes.active?.tokens.get(t))?.[0]?.object ?? null

  const split = args.actionSlug.split(':')
  const isBlast = split[0] === 'blast'
  const actionString = isBlast ? split[1] : split[0]

  const { registerBackgroundRoll, unregisterBackgroundRoll } = useBackgroundRoll()
  registerBackgroundRoll()

  let damage: Promise<unknown> | null
  let critical: Promise<unknown> | null
  let modifiers: Promise<unknown> | null

  if (isBlast) {
    const [element, damageType, isMelee] = actionString.split(',')
    const blast = new game.pf2e.ElementalBlast(actor)
    type BlastParams = Parameters<typeof blast.damage>[0]
    const blastBase: BlastParams = {
      element: element as EffectTrait,
      damageType: damageType as DamageType,
      melee: isMelee === 'true',
      getFormula: true,
      target
    }
    damage = blast.damage(blastBase)
    critical = blast.damage({ ...blastBase, outcome: 'criticalSuccess' })
    modifiers = null
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
    const baseStrike = actor.system.actions.find((a) => a.slug === actionString) as
      | StrikeActionRuntime
      | undefined
    const strike =
      args.altUsage !== undefined ? baseStrike?.altUsages?.[args.altUsage] : baseStrike
    const doesDmg = strike?.item?.dealsDamage ?? false
    damage = doesDmg && strike ? strike.damage(baseDamageOptions) : null
    critical = doesDmg && strike ? strike.critical(baseDamageOptions) : null
    modifiers = doesDmg && strike ? strike.damage(baseModifierOptions) : null
  }

  const results = await Promise.all([damage, critical, modifiers])
  unregisterBackgroundRoll()

  type DamageModifiers = { options?: { damage?: { modifiers?: unknown[] } } }
  return {
    ...makeAck(args),
    response: {
      damage: results[0],
      critical: results[1],
      modifiers: (results[2] as DamageModifiers | null)?.options?.damage?.modifiers
    }
  }
}
