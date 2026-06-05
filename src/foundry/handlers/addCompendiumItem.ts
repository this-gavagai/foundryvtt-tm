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
  await (actor as unknown as { createEmbeddedDocuments(type: string, data: unknown[]): Promise<unknown> })
    .createEmbeddedDocuments('Item', [doc.toObject()])
  return makeAck(args)
}
