import type { RollCheckArgs } from '@/types/api-types'
import { useBackgroundRoll } from '../backgroundRoll'
import { extractRollPayload } from '../utils/roll'
import { getCharacter, getGame, makeAck, makeFakeEvent } from '../utils/foundry'
import { resolveTarget } from '../utils/target'
import { handleBlast, handleBlastDamage } from './checks/blast'
import { handleFlat } from './checks/flat'
import { handleSpellAttack, handleSpellDamage } from './checks/spellCheckHandlers'
import {
  handleFamiliarAttack,
  handleInitiative,
  handlePerception,
  handleSave,
  handleSkill
} from './checks/statistic'
import { handleStrike, handleStrikeDamage } from './checks/strikeCheckHandlers'
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
  familiarAttack: handleFamiliarAttack,
  initiative: handleInitiative,
  spellAttack: handleSpellAttack,
  spellDamage: handleSpellDamage,
  flat: handleFlat
}

export async function foundryRollCheck(args: RollCheckArgs) {
  const source = getGame()
  // https://github.com/foundryvtt/pf2e/blob/68988e12fbec7ea8359b9bee9b0c43eb6964ca3f/src/module/system/statistic/statistic.ts#L617
  const actor = getCharacter(source, args.characterId)
  // _flatModifier is an app-internal option key: a flat untyped bonus/penalty
  // the user set in the Check Roll modal. Convert it to an extra Modifier so
  // PF2e includes it in the statistic's stacking / chat-card breakdown.
  const flatMod = (args.options as { _flatModifier?: number })?._flatModifier ?? 0
  const rawModifiers = flatMod
    ? [
        ...args.modifiers,
        { label: 'Situational', modifier: flatMod, enabled: true, ignored: false }
      ]
    : args.modifiers
  const modifiers = rawModifiers.map((m) => new source.pf2e.Modifier(m))
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
