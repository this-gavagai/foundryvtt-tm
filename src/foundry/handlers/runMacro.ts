import type { MacroPF2e } from '@7h3laughingman/pf2e-types'
import type { RunMacroArgs } from '@/types/api-types'
import { getGame, makeAck } from '../utils/foundry'
import { resolveUuid } from '../globals'
import { getRequestingUser, userCanRunMacro } from '../utils/permissions'
import { resolveRequestedTargets, withMirroredTargets } from '../utils/target'

// Run an arbitrary macro by UUID. Scope follows Foundry's canonical shape:
// `{ actor, token, targets, ...rest }`. _executeScript destructures `actor`
// and `token` for the speaker; remaining keys (we add `targets`) are exposed
// as named parameters inside the macro body, so authors can write e.g.
// `for (const t of targets) { ... }`.
//
// A macro that reads `game.user.targets` directly sees the tablet's selection
// too: execution runs inside withMirroredTargets, which presents the player's
// targets for its duration. That used to be the one documented exception here
// ("won't see the tablet's selection"), but the failure was worse than the note
// admitted — an unshielded macro didn't see NOTHING, it saw the handling GM's
// own reticle, and acted on it. Stock community macros are written against
// game.user.targets, so they were the likeliest thing in the module to hit the
// wrong creature while looking entirely correct.

export async function foundryRunMacro(args: RunMacroArgs) {
  const source = getGame()
  const actor = source.actors.get(args.characterId, { strict: true })

  // Macros are one of the two paths that can genuinely use every target, so
  // they get the whole resolved list — not just the first.
  const { tokens } = resolveRequestedTargets(source, args)

  // Failures throw: the dispatch's central catch turns them into error acks,
  // so the app rejects instead of believing a failed macro ran.
  const macro = await resolveUuid<MacroPF2e>(args.macroUuid)
  if (!macro) throw new Error(`Macro not found: ${args.macroUuid}`)

  // The macro runs with GM privileges, so gate it on the requesting user's own
  // permission to execute it — otherwise any player could run GM utility macros
  // (delete tokens, award XP, edit scenes) by UUID.
  const user = getRequestingUser(source, args.userId)
  if (!user || !userCanRunMacro(macro, user)) {
    throw new Error(`User may not execute macro ${args.macroUuid}`)
  }

  // `async` so an untyped macro.execute() result still satisfies the
  // `() => Promise<T>` the mirror takes.
  await withMirroredTargets(source, tokens, async () =>
    macro.execute({
      actor,
      token: tokens[0],
      targets: tokens
    } as Parameters<MacroPF2e['execute']>[0])
  )
  return makeAck(args)
}
