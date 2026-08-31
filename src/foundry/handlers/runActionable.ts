import type { MacroPF2e } from '@7h3laughingman/pf2e-types'
import type { RunActionableArgs } from '@/types/api-types'
import { actorSpeaker, getGame, makeAck } from '../utils/foundry'
import { chatMessageClass, resolveUuid } from '../globals'
import { getRequestingUser, userCanRunMacro } from '../utils/permissions'
import { resolveRequestedTargets, withMirroredTargets } from '../utils/target'

// Run a PF2e-toolbelt "actionable" macro attached to an action/feat item.
// Matches toolbelt's own useAction() helper (pf2e-toolbelt/scripts/main.js,
// the `Bc` function): looks up the linked macro on the item, then executes
// it with the toolbelt-defined scope so authored macros work unchanged.
//
// Flag schema:
//   newer toolbelt: flags['pf2e-toolbelt'].actionable.linked
//   legacy:         flags['pf2e-toolbelt'].actionable.macro
// We read both with `linked` winning so users on either version are covered.
//
// Macro scope (mirrors toolbelt):
//   actor   — the character using the action
//   item    — the action/feat item the macro is attached to
//   token   — the first targeted Token, if any
//   targets — full array of targeted Tokens. `game.user.targets` presents the
//             same selection for the duration (withMirroredTargets), so a
//             toolbelt macro written against the ambient set — most of them
//             are — acts on the player's target rather than on whatever the
//             handling GM happens to be pointing at.
//   event   — synthetic PointerEvent whose modifier keys are wired to skip
//             every PF2e roll/damage dialog regardless of the GM's settings.
//             PF2e's eventToRollParams computes
//               skipDialog = event.shiftKey ? !skipDefault : skipDefault
//             where skipDefault = !user.settings.show{Check,Damage}Dialogs,
//             so setting shiftKey = (showCheckDialogs || showDamageDialogs)
//             yields skipDialog: true in either branch. Authored macros that
//             forward this event into game.pf2e.actions.X({ event, ... }) or
//             statistic.roll({ event, ... }) suppress dialogs on the GM side.
//   use()   — default-use callback (PF2e's rollItemMacro for non-frequency
//             actions). The macro can call this to fire normal behavior, or
//             ignore it to do something custom.
//   cancel()— post a "cancelled by macro" chat message. Macros use this to
//             abort and explain why (e.g. preconditions not met).
type ToolbeltActionableFlag = { linked?: string; macro?: string }

export async function foundryRunActionable(args: RunActionableArgs) {
  const source = getGame()
  const actor = source.actors.get(args.characterId, { strict: true })
  // Failures throw: the dispatch's central catch turns them into error acks,
  // so the app rejects instead of believing a failed action ran.
  const item = actor.items.get(args.itemId)
  if (!item) throw new Error(`Item ${args.itemId} not found on ${actor.name}`)

  const tbFlag = (
    item.flags as Record<string, { actionable?: ToolbeltActionableFlag } | undefined>
  )?.['pf2e-toolbelt']?.actionable
  const macroUuid = tbFlag?.linked ?? tbFlag?.macro
  if (!macroUuid) throw new Error(`No actionable macro on ${item.name}`)

  const macro = await resolveUuid<MacroPF2e>(macroUuid)
  if (!macro) throw new Error(`Macro not found: ${macroUuid}`)

  // The macro executes with GM privileges. The item is owned by the requester,
  // but its toolbelt flag could point at a macro they can't run themselves
  // (e.g. a GM utility macro), so gate on the requesting user's own execute
  // permission — same check as runMacro.
  const requestingUser = getRequestingUser(source, args.userId)
  if (!requestingUser || !userCanRunMacro(macro, requestingUser)) {
    throw new Error(`User may not execute macro ${macroUuid}`)
  }

  // Toolbelt's macro scope exposes `targets` as the full array, so resolve them
  // all rather than the first — see runMacro.
  const { tokens } = resolveRequestedTargets(source, args)

  // Skip-dialog event — see the scope-docs above for the eventToRollParams
  // math. Either dialog setting being truthy is enough to flip shiftKey on,
  // which yields skipDialog: true for both check and damage dialogs.
  const settings = source.user.settings as {
    showCheckDialogs?: boolean
    showDamageDialogs?: boolean
  }
  const skipDialogEvent = new PointerEvent('click', {
    shiftKey: !!(settings.showCheckDialogs || settings.showDamageDialogs)
  })

  // Default-use callback: PF2e's rollItemMacro posts the item to chat and
  // runs whatever the action's built-in behavior is (frequency tick, chat
  // card, etc). This is what toolbelt's `r` callback resolves to for
  // non-frequency-based actions; matching the contract keeps macros that
  // call `use()` working without rewriting. The event arg suppresses the
  // roll-config dialog on the GM side — the tablet user can't dismiss it.
  const use = async () => {
    return source.pf2e.rollItemMacro?.(item.uuid, skipDialogEvent)
  }

  // Cancel callback: post a chat message indicating the macro stopped the
  // action. Matches toolbelt's own "actionable.action.cancel" wording.
  //
  // actorSpeaker, NOT ChatMessage.getSpeaker: getSpeaker resolves scene and token
  // from whatever scene THIS client has open, which on the elected GM's machine is
  // the GM's own view — it can attach the GM's selected token to a remote player's
  // message, and it is undefined when the GM has no scene loaded. That canvas
  // dependency is also what trips third-party preCreateChatMessage hooks which
  // resolve the token via `canvas.tokens.get(...)`. See actorSpeaker's own note;
  // every other message this module posts already goes through it.
  const cancel = async () => {
    return chatMessageClass().create({
      speaker: actorSpeaker(actor),
      content: `<strong>${item.name}</strong> action was cancelled by its macro.`
    })
  }

  // Stock PF2e action macros (e.g. compendium "Create a Diversion") call
  // `game.pf2e.actions.X()` with no actors, so ActionMacroHelpers falls
  // back to getSelectedActors() → game.user.character. On the GM machine
  // that's the GM's assigned character (or nothing), not the tablet user's
  // character, so the call throws "Select at least one token before
  // rolling, or assign a default character."
  //
  // Override game.user.character on the User instance for the duration of
  // macro execution so the fallback resolves to the tablet's actor. The
  // actor lookup happens synchronously at the top of simpleRollActionCheck
  // (before any await), so the override only needs to live across the
  // execute() call's synchronous prefix; restoring on finally is safe.
  const user = source.user
  const ownCharDescriptor = Object.getOwnPropertyDescriptor(user, 'character')
  Object.defineProperty(user, 'character', {
    value: actor,
    configurable: true,
    writable: true,
    enumerable: true
  })
  // A throwing macro propagates to the central dispatch catch (error ack);
  // only the user.character restoration must survive the unwind.
  //
  // user.character and user.targets are the same kind of substitution — this
  // client's own UI state standing in for the requester's — and the macro needs
  // both to act as the tablet user rather than as the GM running its client.
  try {
    await withMirroredTargets(source, tokens, async () =>
      macro.execute({
        actor,
        item,
        token: tokens[0],
        targets: tokens,
        event: skipDialogEvent,
        use,
        cancel
      } as Parameters<MacroPF2e['execute']>[0])
    )
  } finally {
    if (ownCharDescriptor) {
      Object.defineProperty(user, 'character', ownCharDescriptor)
    } else {
      // No own property existed — remove ours so the prototype getter
      // (User.prototype.character) takes over again. Reflect rather than
      // `delete`, which the compiler refuses on a non-optional property (and
      // rightly: the property is not optional, it's ours to take back off).
      Reflect.deleteProperty(user, 'character')
    }
  }
  return makeAck(args)
}
