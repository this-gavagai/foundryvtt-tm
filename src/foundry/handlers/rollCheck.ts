import type { RollCheckArgs } from '@/types/api-types'
import { withBackgroundRoll } from '../backgroundRoll'
import { extractRollPayload } from '../utils/roll'
import { getCharacter, getGame, makeAck, makeFakeEvent } from '../utils/foundry'
import {
  requirePlaceableTarget,
  resolveRequestedTargets,
  withoutAmbientTargets
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

// Check kinds that resolve their target from `game.user.targets` no matter what
// we pass, so an UNTARGETED request has to run with this client's own selection
// hidden or it borrows the handling GM's reticle (withoutAmbientTargets).
//
// Deliberately a short list rather than "everything untargeted". A statistic
// check — skill, save, perception, initiative, familiar attack, spell attack —
// always receives an actor through statisticParams (the no-target stand-in when
// the player chose nothing), and PF2e reads the ambient Set only when that param
// is absent: `(args.target?.getActiveTokens() ?? [...game.user.targets]).find()`.
// The stand-in returns an empty array there, which is not nullish, so the
// fallback never runs. Shielding those too was harmless in itself but put a
// global property swap around nearly every roll — and this client may be a
// targeting proxy, whose reports must describe the screen (see ownTargetIds).
const NEEDS_AMBIENT_SHIELD = new Set([
  // Strikes and blasts: PF2e builds the roll context with
  // `target: { token: game.user.targets.first() ?? null }`, ignoring params.
  ...PLACEABLE_TARGET_CHECKS,
  // Skill actions go through ActionMacroHelpers, which falls back to
  // `ActionMacroHelpers.target()` — a direct read of the ambient Set.
  'skillAction',
  // SpellPF2e#rollDamage picks its target token out of the ambient Set itself;
  // the injected `target` (utils/spellTargeting.ts) only reaches getDamage.
  'spellDamage'
])

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
  // Resolved once for the whole request: handlers that need the full set (rather
  // than PF2e's single `target`) read it off ctx.targets instead of re-deriving.
  const resolvedTargets = resolveRequestedTargets(source, args)
  if (PLACEABLE_TARGET_CHECKS.has(args.checkType)) requirePlaceableTarget(resolvedTargets)
  const params = {
    modifiers,
    target: resolvedTargets.token,
    skipDialog: true,
    event: makeFakeEvent(source) as PointerEvent,
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
  // A request that named no targets must not pick up the handling client's own
  // reticle. statisticParams covers every path that accepts an actor; the shield
  // covers the few that don't — see NEEDS_AMBIENT_SHIELD.
  const rRaw = await withBackgroundRoll(args.diceResults, () =>
    resolvedTargets.requested === 0 && NEEDS_AMBIENT_SHIELD.has(args.checkType)
      ? withoutAmbientTargets(source, runHandler)
      : runHandler()
  )
  return { ...makeAck(args), ...extractRollPayload(rRaw, args) }
}
