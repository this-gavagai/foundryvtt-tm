import { logger } from '@/utils/utilities'
import type { StrikeActionRuntime } from '@/foundry/utils/strike'
import type { CheckRollHandler } from './types'

export const handleStrike: CheckRollHandler = ({ actor, args, params }) => {
  const [actionSlug, variant, altUsage] = args.checkSubtype.split(',')
  logger.debug("here's some stuff", args.checkSubtype, altUsage, altUsage?.length)
  const baseStrike = actor.system.actions.find((a) => a.slug === actionSlug) as
    | StrikeActionRuntime
    | undefined
  const strikeTarget = altUsage?.length ? baseStrike?.altUsages?.[Number(altUsage)] : baseStrike
  return strikeTarget?.variants[Number(variant)]?.roll(params)
}

export const handleStrikeDamage: CheckRollHandler = ({ actor, args, params }) => {
  logger.debug('TM-params', params)
  const [damageSlug, damageDegree, damageAltUsage] = args.checkSubtype.split(',')
  const baseDmgStrike = actor.system.actions.find((a) => a.slug === damageSlug) as
    | StrikeActionRuntime
    | undefined
  const dmgTarget = damageAltUsage?.length
    ? baseDmgStrike?.altUsages?.[Number(damageAltUsage)]
    : baseDmgStrike
  return damageDegree === 'critical' ? dmgTarget?.critical(params) : dmgTarget?.damage(params)
}
