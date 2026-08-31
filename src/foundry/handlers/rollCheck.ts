import type { RollCheckArgs } from '@/types/api-types'
import { withBackgroundRoll } from '../backgroundRoll'
import { registerCapture, settleCapture } from '../chatCapture'
import { extractRollPayload } from '../utils/roll'
import { describeRollOutcome } from '../utils/rollOutcome'
import { getCharacter, getGame, makeAck, makeFakeEvent } from '../utils/foundry'
import {
  requirePlaceableTarget,
  resolveRequestedTargets,
  withMirroredTargets
} from '../utils/target'
import { handleBlast, handleBlastDamage } from './checks/blast'
import { handleFlat } from './checks/flat'
import { handleSpellAttack, handleSpellDamage } from './checks/spellCheckHandlers'
import {
  handleFamiliarAttack,
  handleInitiative,
  handlePerception,
  handleSave,
  handleSkill,
  handleSkillAction
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
  skillAction: handleSkillAction,
  save: handleSave,
  perception: handlePerception,
  familiarAttack: handleFamiliarAttack,
  initiative: handleInitiative,
  spellAttack: handleSpellAttack,
  spellDamage: handleSpellDamage,
  flat: handleFlat
}

// Check kinds whose PF2e entry point takes a placed Token as its `target`
// (AttackRollParams) rather than an actor, so a resolved token DOCUMENT is not
// enough for them. See requirePlaceableTarget.
const PLACEABLE_TARGET_CHECKS = new Set(['strike', 'damage', 'blast', 'blastDamage'])

// Every check kind is shielded — this client's own selection is swapped out for
// the player's for the duration of the roll (withMirroredTargets), whether the
// player targeted something or nothing.
//
// This used to be a short allow-list: the entry points that ignore their
// `target` param outright (ElementalBlast, which reads
// `game.user.targets.first()` and never looks at params.target; skill actions,
// which resolve through ActionMacroHelpers.target(); SpellPF2e#rollDamage, which
// re-dispatches to a freshly loaded variant that doesn't carry our patch), plus
// strikes for the untargeted case. Everything else was left unshielded on the
// grounds that statisticParams always passes an actor and PF2e reads the ambient
// Set only when that param is absent.
//
// That last part stopped being true. pf2e 8.4.1 resolves an actor param as
// `target?.getActiveTokens(true, true)?.find(…) ?? game.user.targets.find(…)`,
// so the no-target stand-in — whose whole job is to answer "no token" — hands
// the expression an undefined and the ambient half runs anyway. See
// withMirroredTargets for the full note. Shielding uniformly is both the fix and
// the way this stops being a property of one PF2e expression we have to keep
// re-reading.
//
// The cost the old comment weighed against a broad shield — that this client may
// itself be somebody's targeting proxy, whose reports must describe its screen —
// is already paid: ownTargetIds reports through the displaced set, not the
// property, precisely so a swap is invisible to mirroring tablets.

export async function foundryRollCheck(args: RollCheckArgs) {
  const source = getGame()

  // Resolved FIRST, before anything that can refuse for its own reasons: an
  // unrecognized check kind must report itself, not surface as whatever the
  // target resolution below happens to say about a request nobody could have
  // rolled anyway.
  //
  // hasOwnProperty, not a bare index: `checkType` is an untrusted string off the
  // socket, and a plain-object lookup answers 'constructor' / 'toString' with an
  // inherited function that would then be CALLED with the roll context. Same
  // guard, and the same reason, as rpcDescriptor in rpcTable.ts.
  //
  // Throw rather than ack an empty roll: an unknown kind (an app newer than this
  // module, a hand-crafted payload) means nothing was rolled, and
  // extractRollPayload turns the handler's undefined into a SUCCESSFUL ack
  // carrying no roll — which the app opens a result modal for. Matches
  // foundryCharacterAction's refusal of an unknown action slug.
  const handler = Object.prototype.hasOwnProperty.call(CHECK_ROLL_HANDLERS, args.checkType)
    ? CHECK_ROLL_HANDLERS[args.checkType]
    : undefined
  if (!handler) throw new Error(`unknown check type: ${args.checkType}`)

  // https://github.com/foundryvtt/pf2e/blob/68988e12fbec7ea8359b9bee9b0c43eb6964ca3f/src/module/system/statistic/statistic.ts#L617
  const actor = getCharacter(source, args.characterId)
  // _flatModifier is an app-internal option key: a flat untyped bonus/penalty
  // the user set in the Check Roll modal. Convert it to an extra Modifier so
  // PF2e includes it in the statistic's stacking / chat-card breakdown.
  const flatMod = (args.options as { _flatModifier?: number })?._flatModifier ?? 0
  const rawModifiers = flatMod
    ? [
        ...args.modifiers,
        // English literal: neither PF2e nor core defines a key for this, and the
        // module ships no lang files of its own. See localizeOr in globals.ts.
        { label: 'Situational', modifier: flatMod, enabled: true, ignored: false }
      ]
    : args.modifiers
  const modifiers = rawModifiers.map((m) => new source.pf2e.Modifier(m))
  // Resolved once for the whole request: handlers that need the full set (rather
  // than PF2e's single `target`) read it off ctx.targets instead of re-deriving.
  const resolvedTargets = resolveRequestedTargets(source, args)
  if (PLACEABLE_TARGET_CHECKS.has(args.checkType)) requirePlaceableTarget(resolvedTargets)
  const params = {
    modifiers,
    target: resolvedTargets.token,
    skipDialog: true,
    event: makeFakeEvent(source),
    identifier: 'tm_background'
  }
  const ctx: CheckRollContext = {
    source,
    actor,
    args,
    params,
    targetActorProxy: resolvedTargets.actorProxy,
    targets: resolvedTargets
  }

  const runHandler = () => Promise.resolve(handler(ctx))
  // Which chat card this roll posted. PF2e's statistic pipelines create the
  // message themselves and hand back only the roll, so it is matched by request
  // uuid (the listener stamps it during preCreateChatMessage — see
  // chatCapture.ts). Registered BEFORE the roll runs, because that is when the
  // message is created.
  //
  // The app uses it to offer a comment on the roll from the result modal, so a
  // roll whose card can't be identified simply doesn't offer one — nothing else
  // depends on it.
  const capture = registerCapture(args.uuid)
  // Present the player's targets — however many, including none — for the whole
  // roll, so no PF2e path can reach this client's own reticle. See the note
  // above the handler table.
  const rRaw = await withBackgroundRoll(args.diceResults, () =>
    withMirroredTargets(source, resolvedTargets.tokens, runHandler)
  )
  // The card, if there was one, exists by now: PF2e awaits its creation before
  // returning the roll. Settling rather than awaiting the capture's own timeout
  // keeps a roll that posted nothing from delaying its ack by five seconds.
  settleCapture(args.uuid)
  const message = await capture

  return {
    ...makeAck(args),
    ...extractRollPayload(rRaw, args),
    messageId: message?.id ?? message?._id ?? undefined,
    // What the roll was aimed at and how it came out, for the result modal —
    // read off the same card, and withheld field by field where the world does
    // not show a player the DC, the result, or the target's name.
    outcome: describeRollOutcome(source, message, args.userId)
  }
}
