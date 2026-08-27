import type { GetCompendiumIndexArgs, CompendiumIndexEntry } from '@/types/api-types'
import { logger } from '@/utils/utilities'
import { getGame, makeAck } from '../utils/foundry'
import { localizeRarity } from '../utils/labels'
import { getRequestingUser, userCanObservePack } from '../utils/permissions'

// Extra index fields we ask Foundry to load so each browse row can show level
// and rarity without fetching the whole document. An index entry always carries
// _id/name/img/type; these two arrive because they are asked for here.
const INDEX_FIELDS = ['system.level.value', 'system.traits.rarity']

export async function foundryGetCompendiumIndex(args: GetCompendiumIndexArgs) {
  const source = getGame()
  const pack = source.packs.get(args.packId)
  const user = getRequestingUser(source, args.userId)
  if (!pack || !user || !userCanObservePack(pack, user)) {
    logger.warn('TM-GET-COMPENDIUM-INDEX: unknown or unpermitted pack', args.packId)
    return { ...makeAck(args), compendiumIndex: [] }
  }

  const index = await pack.getIndex({ fields: INDEX_FIELDS })
  const compendiumIndex: CompendiumIndexEntry[] = Array.from(index)
    .map((entry) => ({
      // UUID shape consumed by getCompendiumItem: Compendium.<collection>.<DocType>.<id>
      uuid: `Compendium.${pack.collection}.${pack.documentName}.${entry._id}`,
      name: entry.name,
      img: entry.img,
      type: entry.type,
      level: entry.system?.level?.value,
      rarity: entry.system?.traits?.rarity,
      rarityLabel: localizeRarity(entry.system?.traits?.rarity)
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return { ...makeAck(args), compendiumIndex }
}
