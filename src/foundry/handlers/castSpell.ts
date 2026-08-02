import type {
  ActorPF2e,
  ConsumablePF2e,
  SpellPF2e,
  SpellcastingEntryPF2e
} from '@7h3laughingman/pf2e-types'
import type { CastSpellArgs, CastStaffSpellArgs, ConsumeItemArgs } from '@/types/api-types'
import { logger } from '@/utils/utilities'
import { getGame, makeAck } from '../utils/foundry'

declare const Hooks: {
  on: (event: string, cb: (message: unknown, data: unknown) => void) => number
  off: (event: string, id: number) => void
}

type TablemateFlagData = {
  flags?: { tablemate?: Record<string, unknown>; [key: string]: unknown }
}

type CastTargetFlags = { targetTokenIds: string[]; targetSceneId?: string }

// Shape of the message-in-progress we need to identify the cast's own card.
type PendingMessage = {
  flags?: { pf2e?: { origin?: { uuid?: string } | null } | null }
  speaker?: { actor?: string | null } | null
}

function stampCastTargets(message: unknown, data: unknown, flags: CastTargetFlags) {
  const sourceUpdate = { flags: { tablemate: flags } }
  const document = message as { updateSource?: (changes: typeof sourceUpdate) => unknown }
  if (typeof document.updateSource === 'function') {
    document.updateSource(sourceUpdate)
    return
  }

  if (!data || typeof data !== 'object') return
  const source = data as TablemateFlagData
  source.flags ??= {}
  source.flags.tablemate = {
    ...source.flags.tablemate,
    ...flags
  }
}

function pendingMessageOf(message: unknown, data: unknown): PendingMessage {
  const fromDocument = (message ?? {}) as PendingMessage
  const fromData = (data ?? {}) as PendingMessage
  return {
    flags: fromDocument.flags ?? fromData.flags,
    speaker: fromDocument.speaker ?? fromData.speaker
  }
}

// Stamp the player's chosen targets onto the chat card this cast produces, so a
// later click on the card's attack/damage button routes at the same target
// (see spellCardTargeting.ts).
//
// Scoped to the cast's OWN message. The hook is global for the duration of the
// await, so an unscoped version stamped every message created on the GM's client
// in that window — PF2e's secondary messages, and anything a GM-side automation
// module emits — handing unrelated cards a target override. Match on PF2e's
// origin uuid, which is the spell that produced the card; fall back to the
// speaker's actor for message shapes that carry no origin. Stamp once: a cast
// has one card.
//
// Empty target lists are NOT stamped. The flag's presence is what makes the card
// Tablemate-targeted, and stamping `[]` marked a no-target cast as targeted —
// which then forced the card to no-target for everyone who clicked it, including
// a GM with their own token selected in their own UI.
async function withCastTargets<T>(
  cast: { spellUuid: string; spellId: string; actorId: string | null | undefined },
  targetTokenIds: string[],
  targetSceneId: string | undefined,
  run: () => Promise<T>
): Promise<T> {
  if (!targetTokenIds.length) return run()

  const flags: CastTargetFlags = {
    targetTokenIds,
    ...(targetSceneId ? { targetSceneId } : {})
  }
  let stamped = false
  const belongsToCast = (pending: PendingMessage) => {
    const originUuid = pending.flags?.pf2e?.origin?.uuid
    if (originUuid) {
      // Compare the item id as well as the whole uuid: a heightened cast posts
      // its card from a loadVariant() clone, whose uuid can be re-derived even
      // though the underlying item id is the same. Matching only the full string
      // would drop the stamp for exactly the casts most likely to be targeted.
      return originUuid === cast.spellUuid || originUuid.endsWith(`.${cast.spellId}`)
    }
    const speakerActor = pending.speaker?.actor
    return !!speakerActor && speakerActor === cast.actorId
  }

  const hookId = Hooks.on('preCreateChatMessage', (message, data) => {
    if (stamped) return
    if (!belongsToCast(pendingMessageOf(message, data))) return
    stamped = true
    stampCastTargets(message, data, flags)
  })
  try {
    return await run()
  } finally {
    Hooks.off('preCreateChatMessage', hookId)
    if (!stamped) {
      logger.warn('TABLEMATE: cast produced no chat card to carry its targets', cast.spellUuid)
    }
  }
}

export async function foundryCastSpell(args: CastSpellArgs) {
  logger.debug('cast spell', args)
  const source = getGame()
  const actor = source.actors.get(args.characterId, { strict: true })
  const item = actor.items.get(args.id, { strict: true }) as SpellPF2e<ActorPF2e<null>>
  const locationId = item.system.location.value
  const spellLocation = locationId
    ? (actor.items.get(locationId) as SpellcastingEntryPF2e<ActorPF2e<null>>)
    : undefined
  // Throw instead of acking success: a resolvable spell with no castable
  // entry means the cast never happened, and the app must not show one.
  if (!spellLocation) {
    throw new Error(`spell "${item.name}" has no spellcasting entry to cast from`)
  }
  await withCastTargets(
    { spellUuid: item.uuid, spellId: item.id, actorId: actor.id },
    args.targets,
    args.targetScene,
    () =>
      spellLocation.cast(item, {
        rank: args.rank as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10,
        slotId: args.slotId
      })
  )
  return makeAck(args)
}

export async function foundryCastStaffSpell(args: CastStaffSpellArgs) {
  logger.debug('cast staff spell', args)
  const source = getGame()
  const actor = source.actors.get(args.characterId, { strict: true })
  const entryId = `${args.staffId}-casting`
  type SpellCol = { get: (id: string) => SpellPF2e<ActorPF2e<null>> | undefined }
  type Spellcasting = {
    get: (id: string) => SpellcastingEntryPF2e<ActorPF2e<null>> | undefined
    collections: { get: (id: string) => SpellCol | undefined }
  }
  const spellcasting = actor.spellcasting as typeof actor.spellcasting & Spellcasting
  const entry = spellcasting.get(entryId)
  const spell = spellcasting.collections.get(entryId)?.get(args.spellId)
  // Throw instead of acking success: an unresolvable staff entry/spell means
  // the cast never happened, and the app must not show one.
  if (!entry || !spell) {
    throw new Error(`staff spell could not be resolved (entry ${entryId}, spell ${args.spellId})`)
  }
  // Pass spontaneous: { entryId: '' } — pf2e-dailies filters spontaneous entries by
  // entryId, so a blank ID matches nothing, entries.length === 0, and the dialog is
  // skipped. The cast proceeds straight to the normal charge-deduction path.
  await withCastTargets(
    { spellUuid: spell.uuid, spellId: spell.id, actorId: actor.id },
    args.targets,
    args.targetScene,
    () =>
      (
        entry as SpellcastingEntryPF2e<ActorPF2e<null>> & {
          cast: (spell: SpellPF2e<ActorPF2e<null>>, options: object) => Promise<void>
        }
      ).cast(spell, {
        rank: args.rank as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10,
        spontaneous: { entryId: '' }
      })
  )
  return makeAck(args)
}

export async function foundryConsumeItem(args: ConsumeItemArgs) {
  const source = getGame()
  const actor = source.actors.get(args.characterId, { strict: true })
  const item = actor.items.get(args.consumableId, { strict: true }) as ConsumablePF2e<
    ActorPF2e<null>
  >
  await item.consume()
  return makeAck(args)
}
