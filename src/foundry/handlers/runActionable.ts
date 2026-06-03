import type { MacroPF2e, TokenPF2e } from '@7h3laughingman/pf2e-types'
import type { RunActionableArgs } from '@/types/api-types'
import { logger } from '@/utils/utilities'
import { getGame, makeAck } from '../utils/foundry'

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
//   targets — full array of targeted Tokens
//   use()   — default-use callback (PF2e's rollItemMacro for non-frequency
//             actions). The macro can call this to fire normal behavior, or
//             ignore it to do something custom.
//   cancel()— post a "cancelled by macro" chat message. Macros use this to
//             abort and explain why (e.g. preconditions not met).
// fromUuid is async and resolves compendium documents fully (loads the doc
// content). fromUuidSync would return only an index stub for compendium
// UUIDs, which doesn't have `execute()` — calling it throws "r.execute is
// not a function". World macros work either way, but compendium macros
// (Compendium.<pack>.Macro.<id>) require the async path.
declare function fromUuid(uuid: string): Promise<MacroPF2e | null>
declare const ChatMessage: {
  create: (data: object) => Promise<unknown>
  getSpeaker: (opts: { actor?: unknown }) => unknown
}

type ToolbeltActionableFlag = { linked?: string; macro?: string }

export async function foundryRunActionable(args: RunActionableArgs) {
  const source = getGame()
  const actor = source.actors.get(args.characterId, { strict: true })
  const item = actor.items.get(args.itemId)
  if (!item) {
    logger.warn(`TM-RUN-ACTIONABLE: no item ${args.itemId} on ${actor.name}`)
    return makeAck(args)
  }

  const tbFlag = (
    item.flags as Record<string, { actionable?: ToolbeltActionableFlag } | undefined>
  )?.['pf2e-toolbelt']?.actionable
  const macroUuid = tbFlag?.linked ?? tbFlag?.macro
  if (!macroUuid) {
    logger.warn(`TM-RUN-ACTIONABLE: no actionable macro on ${item.name}`)
    return makeAck(args)
  }

  const macro = await fromUuid(macroUuid)
  if (!macro) {
    logger.warn(`TM-RUN-ACTIONABLE: could not resolve macro ${macroUuid}`)
    return makeAck(args)
  }

  const tokenDocs = (args.targets ?? [])
    .map((id) => source.scenes.active?.tokens.get(id))
    .filter((t): t is NonNullable<typeof t> => !!t)
  const tokens = tokenDocs
    .map((t) => t.object as TokenPF2e | null)
    .filter((t): t is TokenPF2e => !!t)

  // Default-use callback: PF2e's rollItemMacro posts the item to chat and
  // runs whatever the action's built-in behavior is (frequency tick, chat
  // card, etc). This is what toolbelt's `r` callback resolves to for
  // non-frequency-based actions; matching the contract keeps macros that
  // call `use()` working without rewriting.
  const use = async () => {
    type Pf2eApi = { rollItemMacro?: (uuid: string) => Promise<unknown> }
    const api = source.pf2e as unknown as Pf2eApi
    return api.rollItemMacro?.(item.uuid)
  }

  // Cancel callback: post a chat message indicating the macro stopped the
  // action. Matches the lang/en.json "actionable.action.cancel" text.
  const cancel = async () => {
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<strong>${item.name}</strong> action was cancelled by its macro.`
    })
  }

  try {
    await macro.execute({
      actor,
      item,
      token: tokens[0],
      targets: tokens,
      use,
      cancel
    } as Parameters<MacroPF2e['execute']>[0])
  } catch (e) {
    logger.warn('TM-RUN-ACTIONABLE: macro threw', macroUuid, e)
  }
  return makeAck(args)
}
