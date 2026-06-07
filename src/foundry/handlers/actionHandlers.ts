import type { ActionUseOptions, ActorPF2e, Statistic } from '@7h3laughingman/pf2e-types'
import type {
  CharacterActionArgs,
  FreeRollArgs,
  SendItemToChatArgs
} from '@/types/api-types'
import { logger } from '@/utils/utilities'
import { useBackgroundRoll } from '../backgroundRoll'
import { getGame, makeAck, makeFakeEvent } from '../utils/foundry'
import type { FoundryRoll } from '../utils/roll'
import { resolveTarget } from '../utils/target'
import { withModifierOverrides } from './checks/modifierOverrides'

// Narrowed shadow over the ambient Roll global from foundry-types. The
// generic Foundry Roll has total as optional; FoundryRoll narrows it to
// non-optional after .evaluate().
declare const Roll: new (formula: string) => FoundryRoll

export async function foundryCharacterAction(args: CharacterActionArgs) {
  const source = getGame()
  const actor = source.actors.get(args.characterId, { strict: true })

  // Use the actor-proxy pattern so PF2e's statistic API resolves the target's
  // token via getActiveTokens() rather than reading game.user.targets, which
  // on the handler machine reflects the GM's (or proxy's) own UI state.
  // tricky code: https://github.com/foundryvtt/pf2e/blob/2eaef272f3e17f340eba1b7f2dc82e857d8d296e/src/module/actor/actions/single-check.ts#L160
  const { token, actorProxy } = resolveTarget(source, args.targets)
  const params = {
    ...args.options,
    actors: actor,
    target: actorProxy ?? token,
    event: makeFakeEvent(source)
  }

  const { registerBackgroundRoll, unregisterBackgroundRoll } = useBackgroundRoll(args.diceResults)
  registerBackgroundRoll()

  const getStatistic = args.statisticSlug
    ? (a: ActorPF2e): Statistic | null =>
        (a as ActorPF2e & { skills?: Record<string, Statistic> }).skills?.[args.statisticSlug!] ??
        (a as ActorPF2e & { saves?: Record<string, Statistic> }).saves?.[args.statisticSlug!] ??
        (args.statisticSlug === 'perception'
          ? (a as ActorPF2e & { perception?: Statistic }).perception ?? null
          : null)
    : undefined

  type ActionResult = {
    message?: { whisper?: string[] }
    roll?: { formula: unknown; result: unknown; total: unknown; dice: unknown }
  }

  let r: ActionResult[] | undefined
  try {
    r = (await withModifierOverrides(
      actor,
      getStatistic ?? (() => null),
      args.modifierOverrides,
      () =>
        source.pf2e.actions
          .get(args.characterAction)
          ?.use(params as unknown as Partial<ActionUseOptions>) as Promise<ActionResult[]>
    )) as ActionResult[] | undefined
  } finally {
    unregisterBackgroundRoll()
  }

  logger.debug(r, args.characterAction)
  const isSecret =
    (r?.[0]?.message?.whisper?.length ?? 0) > 0 && !r?.[0]?.message?.whisper?.includes(args.userId)
  const { formula, result, total, dice } = r?.[0]?.roll ?? {}
  return { ...makeAck(args), roll: { formula, result, total, dice, isSecret } }
}

// Raw 1d20 roll from the side-menu Check Roll modal's "Roll d20" fallback —
// only fires when the user hasn't selected a specific stat chit. Damage
// formulas are no longer routed here; see foundryRollDamage.
export async function foundryFreeRoll(args: FreeRollArgs) {
  logger.debug('free roll', args)
  const source = getGame()
  const actor = source.actors.get(args.characterId, { strict: true })
  const { registerBackgroundRoll, unregisterBackgroundRoll } = useBackgroundRoll(args.diceResults)
  registerBackgroundRoll()
  const rollMode = args.secret ? 'blindroll' : 'publicroll'
  // Display labels — purely a tag on the chat message so a glance at the chat
  // log identifies what the roll was for. No mechanical effect.
  const flavor = args.traits?.length ? args.traits.join(', ') : undefined
  const modSuffix = args.modifier
    ? args.modifier > 0
      ? `+${args.modifier}`
      : `${args.modifier}`
    : ''
  const roll: FoundryRoll = await new Roll(`1d20${modSuffix}`).evaluate()
  await roll.toMessage({ speaker: { actor: actor._id ?? undefined }, flavor }, { rollMode })
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
