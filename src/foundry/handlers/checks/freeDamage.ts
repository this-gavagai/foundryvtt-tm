import { rollDamageFormulaToMessage } from '@/foundry/utils/roll'
import type { CheckRollHandler } from './types'

// Arbitrary inline damage roll from an @Damage[...] in a description. The
// formula is already client-resolved (@item.level / @actor.x etc. substituted
// in ParsedDescription against the item context the app already has), so we
// don't need any item lookup or roll-data here.
export const handleFreeDamage: CheckRollHandler = ({ actor, args }) =>
  rollDamageFormulaToMessage(args.checkSubtype, actor)
