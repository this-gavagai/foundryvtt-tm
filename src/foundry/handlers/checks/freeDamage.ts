import { rollDamageFormulaToMessage } from '@/foundry/utils/roll'
import type { CheckRollHandler } from './types'

// Arbitrary inline damage roll from an @Damage[...] in a description. The
// formula is fully client-resolved in ParsedDescription (item.* refs against
// the parent component's rollData prop, actor.* refs against the injected raw
// actor) before being shipped here.
export const handleFreeDamage: CheckRollHandler = ({ actor, args }) =>
  rollDamageFormulaToMessage(args.checkSubtype, actor)
