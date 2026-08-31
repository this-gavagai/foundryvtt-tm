import type { ActorPF2e, ItemPF2e, Statistic } from '@7h3laughingman/pf2e-types'
import type {
  CharacterActionArgs,
  FreeRollArgs,
  RollResult,
  SendItemToChatArgs,
  SendCompendiumItemToChatArgs
} from '@/types/api-types'
import { logger } from '@/utils/utilities'
import { withBackgroundRoll } from '../backgroundRoll'
import { getGame, makeAck, makeFakeEvent } from '../utils/foundry'
import { itemClass, resolveUuid } from '../globals'
import {
  compendiumPackIdFromUuid,
  getRequestingUser,
  userCanObservePack
} from '../utils/permissions'
import { extractRollPayload, rollClass, type FoundryRoll } from '../utils/roll'
import { describeRollOutcome, outcomeMessageOf } from '../utils/rollOutcome'
import { resolveRequestedTargets, withMirroredTargets } from '../utils/target'
import { withModifierOverrides } from './checks/modifierOverrides'

export async function foundryCharacterAction(args: CharacterActionArgs) {
  const source = getGame()
  const actor = source.actors.get(args.characterId, { strict: true })

  // Use the actor-proxy pattern so PF2e's statistic API resolves the target's
  // token via getActiveTokens() rather than reading game.user.targets, which
  // on the handler machine reflects the GM's (or proxy's) own UI state.
  // tricky code: https://github.com/foundryvtt/pf2e/blob/2eaef272f3e17f340eba1b7f2dc82e857d8d296e/src/module/actor/actions/single-check.ts#L160
  //
  // The proxy covers the TARGETED case only. With no target the param below is
  // undefined, and SingleCheckActionVariant#use answers its own target callback
  // with null — at which point simpleRollActionCheck falls through to
  // `ActionMacroHelpers.target()`, a bare `Array.from(game.user.targets)` read,
  // and the action rolls against whatever the handling GM is pointing at. Hence
  // the mirror below, which is what the identical `use()` path in
  // handlers/checks/statistic.ts (handleSkillAction) has always had.
  const { token, actorProxy, tokens } = resolveRequestedTargets(source, args)
  const params = {
    ...args.options,
    actors: actor,
    // `?? undefined` because PF2e's ActionUseOptions declares `target` optional,
    // not nullable, and resolveRequestedTargets answers null for "no target".
    target: actorProxy ?? token ?? undefined,
    event: makeFakeEvent(source)
  }

  const getStatistic = args.statisticSlug
    ? (a: ActorPF2e): Statistic | null =>
        (a as ActorPF2e & { skills?: Record<string, Statistic> }).skills?.[args.statisticSlug!] ??
        (a as ActorPF2e & { saves?: Record<string, Statistic> }).saves?.[args.statisticSlug!] ??
        (args.statisticSlug === 'perception'
          ? ((a as ActorPF2e & { perception?: Statistic }).perception ?? null)
          : null)
    : undefined

  // Throw instead of acking a garbage roll: an unresolvable slug (renamed
  // PF2e action, removed homebrew) means nothing was rolled, and the app
  // must not open a success modal for it.
  const action = source.pf2e.actions.get(args.characterAction)
  if (!action) throw new Error(`unknown character action: ${args.characterAction}`)

  const r = await withBackgroundRoll(args.diceResults, () =>
    withMirroredTargets(source, tokens, () =>
      withModifierOverrides(actor, getStatistic ?? (() => null), args.modifierOverrides, () =>
        action.use(params)
      )
    )
  )

  logger.debug(r, args.characterAction)
  return {
    ...makeAck(args),
    ...extractRollPayload(r, args),
    // What the action was rolled against and how it came out, for the result
    // modal. Read off the card the pipeline posted, which it hands back here —
    // no capture needed, unlike the roll handlers.
    outcome: describeRollOutcome(source, outcomeMessageOf(r), args.userId)
  }
}

// Raw 1d20 roll from the side-menu Check Roll modal's "Roll d20" fallback —
// only fires when the user hasn't selected a specific stat chit. Damage
// formulas are no longer routed here; see foundryRollDamage.
export async function foundryFreeRoll(args: FreeRollArgs) {
  logger.debug('free roll', args)
  const source = getGame()
  const actor = source.actors.get(args.characterId, { strict: true })
  const rollMode = args.secret ? 'blindroll' : 'publicroll'
  // Display labels — purely a tag on the chat message so a glance at the chat
  // log identifies what the roll was for. No mechanical effect.
  const flavor = args.traits?.length ? args.traits.join(', ') : undefined
  const modSuffix = args.modifier
    ? args.modifier > 0
      ? `+${args.modifier}`
      : `${args.modifier}`
    : ''
  const roll: FoundryRoll = await withBackgroundRoll(args.diceResults, async () => {
    const r: FoundryRoll = await new (rollClass())(`1d20${modSuffix}`).evaluate()
    await r.toMessage({ speaker: { actor: actor._id ?? undefined }, flavor }, { rollMode })
    return r
  })
  // Typed local so field names/arity stay compiler-checked.
  const payload: RollResult = {
    formula: roll.formula,
    result: String(roll.total),
    total: roll.total,
    dice: roll.dice,
    isSecret: args.secret
  }
  return { ...makeAck(args), roll: payload }
}

export async function foundrySendItemToChat(args: SendItemToChatArgs) {
  const actor = getGame().actors.get(args.characterId)
  const item = actor?.items?.get(args.itemId)
  // Throw instead of acking success: nothing was posted to chat.
  if (!item) throw new Error(`item ${args.itemId} not found on actor ${args.characterId}`)
  await item.toChat()
  return makeAck(args)
}

export async function foundrySendCompendiumItemToChat(args: SendCompendiumItemToChatArgs) {
  const source = getGame()
  // Throw (strict get) instead of acking success on every refused/failed path
  // below: nothing was posted to chat, and the app must not show a success.
  const actor = source.actors.get(args.characterId, { strict: true })

  // Only post items from a compendium the requesting user may observe — a bare
  // fromUuid would otherwise let a player broadcast any document's contents.
  const packId = compendiumPackIdFromUuid(args.itemUuid)
  const pack = packId ? source.packs.get(packId) : undefined
  const user = getRequestingUser(source, args.userId)
  if (
    !packId ||
    !pack ||
    pack.documentName !== 'Item' ||
    !user ||
    !userCanObservePack(pack, user)
  ) {
    logger.warn('TM-SEND-COMPENDIUM-ITEM: not permitted or not a compendium item', args.itemUuid)
    throw new Error(`compendium item not permitted or not a compendium item: ${args.itemUuid}`)
  }

  const doc = await resolveUuid<ItemPF2e>(args.itemUuid)
  if (!doc) throw new Error(`compendium item could not be resolved: ${args.itemUuid}`)
  // PF2e's toChat() requires an owned item. Create a temporary in-memory item
  // with the character as parent so the ownership check passes without persisting.
  const tempItem = new (itemClass())(doc.toObject(), { parent: actor })
  await tempItem.toChat()
  return makeAck(args)
}
