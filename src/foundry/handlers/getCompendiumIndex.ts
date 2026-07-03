import type { GetCompendiumIndexArgs, CompendiumIndexEntry } from '@/types/api-types'
import { logger } from '@/utils/utilities'
import { getGame, makeAck } from '../utils/foundry'
import { localizeRarity } from '../utils/labels'

// Index entries carry the fields Foundry always indexes (_id, name, img, type)
// plus whatever extra `fields` we request below.
interface IndexEntry {
  _id: string
  name: string
  img?: string
  type?: string
  system?: { level?: { value?: number }; traits?: { rarity?: string } }
}

interface PackLike {
  collection: string
  documentName: string
  getIndex(options?: { fields?: string[] }): Promise<Iterable<IndexEntry>>
}

// Extra index fields we ask Foundry to load so each browse row can show level
// and rarity without fetching the whole document.
const INDEX_FIELDS = ['system.level.value', 'system.traits.rarity']

export async function foundryGetCompendiumIndex(args: GetCompendiumIndexArgs) {
  const pack = getGame().packs.get(args.packId) as unknown as PackLike | undefined
  if (!pack) {
    logger.warn('TM-GET-COMPENDIUM-INDEX: unknown pack', args.packId)
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
