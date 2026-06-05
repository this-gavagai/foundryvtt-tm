import type { GetCompendiumItemArgs } from '@/types/api-types'
import { logger } from '@/utils/utilities'
import { getGame, makeAck } from '../utils/foundry'

declare function fromUuid(uuid: string): Promise<{
  toObject(): {
    _id?: string
    name: string
    img?: string
    type?: string
    system: Record<string, unknown>
  }
} | null>

export async function foundryGetCompendiumItem(args: GetCompendiumItemArgs) {
  const doc = await fromUuid(args.itemUuid)
  if (!doc) {
    logger.warn('TM-GET-COMPENDIUM-ITEM: could not resolve', args.itemUuid)
    return { ...makeAck(args), compendiumItem: null }
  }
  // UUID shape: Compendium.<scope>.<pack>.<type>.<id>
  // e.g. Compendium.pf2e.conditionitems.Item.xyz → pack id "pf2e.conditionitems"
  const uuidParts = args.itemUuid.split('.')
  const packId = uuidParts.length >= 3 ? `${uuidParts[1]}.${uuidParts[2]}` : args.itemUuid
  const source = getGame().packs.get(packId)?.metadata.label ?? packId

  return {
    ...makeAck(args),
    compendiumItem: { ...doc.toObject(), source }
  }
}
