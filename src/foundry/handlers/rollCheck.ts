import type { RollCheckArgs } from '@/types/api-types'
import { useBackgroundRoll } from '../backgroundRoll'
import { extractRollPayload } from '../utils/roll'
import { getCharacter, getGame, makeAck, makeFakeEvent } from '../utils/foundry'
import { resolveTarget } from '../utils/target'
import { handleBlast, handleBlastDamage } from './checks/blast'
import { handleFlat } from './checks/flat'
import { handleFreeDamage } from './checks/freeDamage'
import { handleSpellAttack, handleSpellDamage } from './checks/spell'
import {
  handleInitiative,
  handlePerception,
  handleSave,
  handleSkill
} from './checks/statistic'
import { handleStrike, handleStrikeDamage } from './checks/strike'
import type { CheckRollContext, CheckRollHandler } from './checks/types'

// checkType (wire) → handler. Adding a new check kind is one entry here plus
// the handler definition; no edits to the orchestrator.
const CHECK_ROLL_HANDLERS: Record<string, CheckRollHandler> = {
  strike: handleStrike,
  damage: handleStrikeDamage,
  blast: handleBlast,
  blastDamage: handleBlastDamage,
  skill: handleSkill,
  save: handleSave,
  perception: handlePerception,
  initiative: handleInitiative,
  spellAttack: handleSpellAttack,
  freeDamage: handleFreeDamage,
  spellDamage: handleSpellDamage,
  flat: handleFlat
}

export async function foundryRollCheck(args: RollCheckArgs) {
  const source = getGame()
  // https://github.com/foundryvtt/pf2e/blob/68988e12fbec7ea8359b9bee9b0c43eb6964ca3f/src/module/system/statistic/statistic.ts#L617
  const actor = getCharacter(source, args.characterId)
  const modifiers = args.modifiers.map((m) => new source.pf2e.Modifier(m))
  const { token, actorProxy: targetActorProxy } = resolveTarget(source, args.targets)
  const params = {
    modifiers,
    target: token,
    skipDialog: true,
    event: makeFakeEvent(source) as PointerEvent,
    identifier: 'tm_background'
  }
  const ctx: CheckRollContext = { source, actor, args, params, targetActorProxy }

  const { registerBackgroundRoll, unregisterBackgroundRoll } = useBackgroundRoll(args.diceResults)
  registerBackgroundRoll()
  const rRaw = await CHECK_ROLL_HANDLERS[args.checkType]?.(ctx)
  unregisterBackgroundRoll()
  return { ...makeAck(args), ...extractRollPayload(rRaw, args) }
}
