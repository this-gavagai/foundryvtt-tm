import type { AddCompendiumItemArgs } from '@/types/api-types'
import { logger } from '@/utils/utilities'
import { getGame, makeAck } from '../utils/foundry'
import {
  compendiumPackIdFromUuid,
  getRequestingUser,
  userCanObservePack
} from '../utils/permissions'

declare function fromUuid(uuid: string): Promise<{ toObject(): Record<string, unknown> } | null>

export async function foundryAddCompendiumItem(args: AddCompendiumItemArgs) {
  const source = getGame()
  const actor = source.actors.get(args.characterId, { strict: true })

  // Only copy items out of a compendium the requesting user may observe, and
  // only from an Item pack — otherwise a player could pull items from GM-only
  // packs, or embed a non-Item document, via a crafted UUID.
  // Throw instead of acking success on every refused/failed path below: a
  // plain ack would make the app show an item that was never added.
  const packId = compendiumPackIdFromUuid(args.itemUuid)
  const pack = packId ? source.packs.get(packId) : undefined
  const user = getRequestingUser(source, args.userId)
  if (!packId || !pack || !user || !userCanObservePack(pack, user)) {
    logger.warn('TM-ADD-COMPENDIUM-ITEM: not permitted or not a compendium uuid', args.itemUuid)
    throw new Error(`compendium item not permitted or not a compendium uuid: ${args.itemUuid}`)
  }
  if (pack.documentName !== 'Item') {
    logger.warn('TM-ADD-COMPENDIUM-ITEM: not an Item pack', args.itemUuid)
    throw new Error(`not an Item pack: ${args.itemUuid}`)
  }

  const doc = await fromUuid(args.itemUuid)
  if (!doc) {
    logger.warn('TM-ADD-COMPENDIUM-ITEM: could not resolve', args.itemUuid)
    throw new Error(`compendium item could not be resolved: ${args.itemUuid}`)
  }
  const itemData = doc.toObject() as Record<string, unknown>
  if (args.spellcastingEntryId && itemData.type === 'spell') {
    const system = (itemData.system ?? {}) as Record<string, unknown>
    const location = (system.location ?? {}) as Record<string, unknown>
    itemData.system = { ...system, location: { ...location, value: args.spellcastingEntryId } }
  }
  await actor.createEmbeddedDocuments('Item', [itemData])
  return makeAck(args)
}
