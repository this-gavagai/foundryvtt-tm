import type {
  ActorPF2e,
  ConsumablePF2e,
  SpellPF2e,
  SpellcastingEntryPF2e
} from '@7h3laughingman/pf2e-types'
import type { CastSpellArgs, CastStaffSpellArgs, ConsumeItemArgs } from '@/types/api-types'
import { logger } from '@/utils/utilities'
import { getGame, makeAck } from '../utils/foundry'

export async function foundryCastSpell(args: CastSpellArgs) {
  logger.debug('cast spell', args)
  const source = getGame()
  const actor = source.actors.get(args.characterId, { strict: true })
  const item = actor.items.get(args.id, { strict: true }) as SpellPF2e<ActorPF2e<null>>
  const locationId = item.system.location.value
  const spellLocation = locationId
    ? (actor.items.get(locationId) as SpellcastingEntryPF2e<ActorPF2e<null>>)
    : undefined
  await spellLocation?.cast(item, {
    rank: args.rank as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10,
    slotId: args.slotId
  })
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
  const spellcasting = actor.spellcasting as unknown as Spellcasting
  const entry = spellcasting.get(entryId)
  const spell = spellcasting.collections.get(entryId)?.get(args.spellId)
  if (entry && spell) {
    // Pass spontaneous: { entryId: '' } — pf2e-dailies filters spontaneous entries by
    // entryId, so a blank ID matches nothing, entries.length === 0, and the dialog is
    // skipped. The cast proceeds straight to the normal charge-deduction path.
    await (
      entry as unknown as {
        cast: (spell: SpellPF2e<ActorPF2e<null>>, options: object) => Promise<void>
      }
    ).cast(spell, {
      rank: args.rank as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10,
      spontaneous: { entryId: '' }
    })
  }
  return makeAck(args)
}

export async function foundryConsumeItem(args: ConsumeItemArgs) {
  const source = getGame()
  const actor = source.actors.get(args.characterId, { strict: true })
  const item = actor.items.get(args.consumableId, { strict: true }) as ConsumablePF2e<
    ActorPF2e<null>
  >
  item.consume()
  return makeAck(args)
}
