import type { RollCheckArgs } from '@/types/api-types'
import { withBackgroundRoll } from '../backgroundRoll'
import { extractRollPayload } from '../utils/roll'
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

// Check kinds whose PF2e entry point reads `game.user.targets` — so this
// client's own selection has to be swapped out for the player's for the
// duration of the roll (withMirroredTargets), whether the player targeted
// something or nothing.
//
// BOTH halves matter, and only one of them used to be covered. With no targets,
// an unshielded roll inherits the handling GM's reticle. WITH targets, an
// unshielded roll still inherits it wherever PF2e ignores the `target` param we
// pass — which is most of this list:
//
//   • ElementalBlast#attack builds its context as
//     `target: game.user.targets.first()?.actor ?? null` and never reads
//     params.target at all; #damage does the same. A targeted blast therefore
//     rolled against whatever the GM was pointing at.
//   • Skill actions go through ActionMacroHelpers, which resolves its target
//     with `ActionMacroHelpers.target()` — a direct read of the ambient Set,
//     with no param path.
//   • SpellPF2e#rollDamage picks its target out of the ambient Set itself. The
//     injected `target` (utils/spellTargeting.ts) reaches getDamage, but PF2e
//     re-dispatches to a freshly loaded variant when the spell isn't one
//     already — and that variant does not carry the patch.
//   • Strikes are the exception: `params.target ?? game.user.targets.first()`,
//     so the param wins when there is one. They stay on the list for the
//     untargeted case, and mirroring is a no-op for them otherwise.
//
// Deliberately a short list rather than "every check". A statistic check —
// skill, save, perception, initiative, familiar attack, spell attack — always
// receives an actor through statisticParams (the no-target stand-in when the
// player chose nothing), and PF2e reads the ambient Set only when that param is
// absent: `(args.target?.getActiveTokens() ?? [...game.user.targets]).find()`.
// The stand-in returns an empty array there, which is not nullish, so the
// fallback never runs. Shielding those too would be harmless in itself but puts
// a global property swap around nearly every roll — and this client may be a
// targeting proxy, whose reports must describe the screen (see ownTargetIds).
const NEEDS_AMBIENT_SHIELD = new Set([...PLACEABLE_TARGET_CHECKS, 'skillAction', 'spellDamage'])

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

  const runHandler = () => Promise.resolve(CHECK_ROLL_HANDLERS[args.checkType]?.(ctx))
  // Present the player's targets — however many, including none — to the check
  // kinds that read the ambient Set. statisticParams covers every path that
  // accepts an actor; this covers the few that don't. See NEEDS_AMBIENT_SHIELD.
  const rRaw = await withBackgroundRoll(args.diceResults, () =>
    NEEDS_AMBIENT_SHIELD.has(args.checkType)
      ? withMirroredTargets(source, resolvedTargets.tokens, runHandler)
      : runHandler()
  )
  return { ...makeAck(args), ...extractRollPayload(rRaw, args) }
}
