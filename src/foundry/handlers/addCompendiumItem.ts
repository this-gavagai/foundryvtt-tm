import type { AddCompendiumItemArgs } from '@/types/api-types'
import { logger } from '@/utils/utilities'
import { getGame, makeAck } from '../utils/foundry'

declare function fromUuid(uuid: string): Promise<{ toObject(): Record<string, unknown> } | null>

export async function foundryAddCompendiumItem(args: AddCompendiumItemArgs) {
  const source = getGame()
  const actor = source.actors.get(args.characterId, { strict: true })
  const doc = await fromUuid(args.itemUuid)
  if (!doc) {
    logger.warn('TM-ADD-COMPENDIUM-ITEM: could not resolve', args.itemUuid)
    return makeAck(args)
  }
  const itemData = doc.toObject() as Record<string, unknown>
  if (args.spellcastingEntryId && (itemData.type === 'spell')) {
    const system = (itemData.system ?? {}) as Record<string, unknown>
    const location = (system.location ?? {}) as Record<string, unknown>
    itemData.system = { ...system, location: { ...location, value: args.spellcastingEntryId } }
  }
  await actor.createEmbeddedDocuments('Item', [itemData])
  return makeAck(args)
}
