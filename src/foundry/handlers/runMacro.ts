import type { MacroPF2e, TokenPF2e } from '@7h3laughingman/pf2e-types'
import type { RunMacroArgs } from '@/types/api-types'
import { logger } from '@/utils/utilities'
import { getGame, makeAck } from '../utils/foundry'
import { getRequestingUser, userCanRunMacro } from '../utils/permissions'

// Run an arbitrary macro by UUID. Scope follows Foundry's canonical shape:
// `{ actor, token, targets, ...rest }`. _executeScript destructures `actor`
// and `token` for the speaker; remaining keys (we add `targets`) are exposed
// as named parameters inside the macro body, so authors can write e.g.
// `for (const t of targets) { ... }` without going through game.user.targets
// (which on the GM machine reflects the GM's UI, not the tablet user's).
//
// Macros that read `game.user.targets` directly won't see the tablet's
// selection — they need to be adapted to use the scope `targets` instead.
//
// fromUuid is async and required for compendium UUIDs: the sync variant
// returns an index stub for compendium docs that has no `execute()`, so
// any Compendium.<pack>.Macro.<id> path throws "r.execute is not a
// function" if you call it through fromUuidSync.
declare function fromUuid(uuid: string): Promise<MacroPF2e | null>

export async function foundryRunMacro(args: RunMacroArgs) {
  const source = getGame()
  const actor = source.actors.get(args.characterId, { strict: true })

  const tokenDocs = (args.targets ?? [])
    .map((id) => source.scenes.active?.tokens.get(id))
    .filter((t): t is NonNullable<typeof t> => !!t)
  const tokens = tokenDocs
    .map((t) => t.object as TokenPF2e | null)
    .filter((t): t is TokenPF2e => !!t)

  const macro = await fromUuid(args.macroUuid)
  if (!macro) {
    logger.warn(`TM-RUN-MACRO: could not resolve ${args.macroUuid}`)
    return makeAck(args)
  }

  // The macro runs with GM privileges, so gate it on the requesting user's own
  // permission to execute it — otherwise any player could run GM utility macros
  // (delete tokens, award XP, edit scenes) by UUID.
  const user = getRequestingUser(source, args.userId)
  if (!user || !userCanRunMacro(macro, user)) {
    logger.warn(`TM-RUN-MACRO: ${args.userId} may not execute ${args.macroUuid}`)
    return makeAck(args)
  }

  try {
    await macro.execute({
      actor,
      token: tokens[0],
      targets: tokens
    } as Parameters<MacroPF2e['execute']>[0])
  } catch (e) {
    logger.warn('TM-RUN-MACRO: macro threw', args.macroUuid, e)
  }
  return makeAck(args)
}
