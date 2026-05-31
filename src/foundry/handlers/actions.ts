import type { ActionUseOptions, MacroPF2e } from '@7h3laughingman/pf2e-types'
import type {
  CallMacroArgs,
  CharacterActionArgs,
  FreeRollArgs,
  SendItemToChatArgs
} from '@/types/api-types'
import { logger } from '@/utils/utilities'
import { useBackgroundRoll } from '../backgroundRoll'
import { getGame, makeAck, makeFakeEvent } from '../utils/foundry'
import { type FoundryRoll, rollDamageFormulaToMessage } from '../utils/roll'

// Narrowed shadows over the ambient declarations from foundry-types /
// pf2e-types. Macro globally is foundry.documents.Macro; we want the PF2e
// subclass. Roll globally is the generic Foundry Roll; we want the narrower
// FoundryRoll shape so `total` is non-optional after .evaluate().
declare const Macro: typeof MacroPF2e
declare function fromUuidSync(uuid: string): MacroPF2e
declare const Roll: new (formula: string) => FoundryRoll

export async function foundryCharacterAction(args: CharacterActionArgs) {
  const source = getGame()
  const actor = source.actors.get(args.characterId, { strict: true })
  const targetTokenDoc =
    args.targets.map((t: string) => source.scenes.active?.tokens.get(t))[0] ?? null
  // tricky code: https://github.com/foundryvtt/pf2e/blob/2eaef272f3e17f340eba1b7f2dc82e857d8d296e/src/module/actor/actions/single-check.ts#L160
  const params = {
    ...args.options,
    actors: actor,
    target: targetTokenDoc?.object,
    event: makeFakeEvent(source)
  }

  const { registerBackgroundRoll, unregisterBackgroundRoll } = useBackgroundRoll(args.diceResults)
  registerBackgroundRoll()

  const promise = source.pf2e.actions
    .get(args.characterAction)
    ?.use(params as unknown as Partial<ActionUseOptions>)
  type ActionResult = {
    message?: { whisper?: string[] }
    roll?: { formula: unknown; result: unknown; total: unknown; dice: unknown }
  }
  const r = (await promise) as ActionResult[] | undefined
  logger.debug(r, promise, args.characterAction)
  const isSecret =
    (r?.[0]?.message?.whisper?.length ?? 0) > 0 && !r?.[0]?.message?.whisper?.includes(args.userId)
  const { formula, result, total, dice } = r?.[0]?.roll ?? {}
  unregisterBackgroundRoll()
  return { ...makeAck(args), roll: { formula, result, total, dice, isSecret } }
}

export async function foundryFreeRoll(args: FreeRollArgs) {
  logger.debug('free roll', args)
  const source = getGame()
  const actor = source.actors.get(args.characterId, { strict: true })
  const { registerBackgroundRoll, unregisterBackgroundRoll } = useBackgroundRoll(args.diceResults)
  registerBackgroundRoll()
  const rollMode = args.secret ? 'blindroll' : 'publicroll'
  // Damage path: any formula carrying type tags (e.g. "2d6[fire]+1d4[bleed]")
  // builds a typed PF2e DamageRoll chat card. Otherwise: plain 1d20.
  let roll: FoundryRoll
  if (args.damageFormula) {
    roll = await rollDamageFormulaToMessage(args.damageFormula, actor, { rollMode })
  } else {
    roll = await new Roll('1d20').evaluate()
    await roll.toMessage({ speaker: { actor: actor._id ?? undefined } }, { rollMode })
  }
  unregisterBackgroundRoll()
  return {
    ...makeAck(args),
    roll: {
      formula: roll.formula,
      result: String(roll.total),
      total: roll.total,
      dice: roll.dice,
      isSecret: args.secret
    }
  } as ReturnType<typeof makeAck> & {
    roll: { formula: string; result: string; total: number; dice: unknown; isSecret: boolean }
  }
}

export async function foundrySendItemToChat(args: SendItemToChatArgs) {
  const actor = game.actors.get(args.characterId)
  const item = actor?.items?.get(args.itemId)
  if (item) item.toChat()
  return makeAck(args)
}

export async function foundryCallMacro(args: CallMacroArgs) {
  logger.debug('running macro', args)
  if (!args.compendiumName) return
  const actor = game.actors.get(args.characterId)
  const pack = game.packs.get(args.compendiumName)

  if (args.macroUuid) {
    const macro = fromUuidSync(args.macroUuid)
    // TODO: test args.targets stuff
    logger.debug(args.targets)
    macro.execute({ scope: { actor, targets: args.targets } })
  } else {
    if (!pack) return Promise.resolve(null)
    const macro_data = (await pack.getDocuments())
      .find((i: { name: string }) => i.name === args.macroName)
      ?.toObject()
    if (!macro_data) return Promise.resolve(null)
    const temp_macro = new Macro(macro_data)
    temp_macro.type = 'script'
    temp_macro.execute({ actor })
  }

  return makeAck(args)
}
