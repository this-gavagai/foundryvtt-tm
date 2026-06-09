import type { ListCompendiaArgs, CompendiumPackInfo } from '@/types/api-types'
import { getGame, makeAck } from '../utils/foundry'

// Minimal shape of a CompendiumCollection we read from game.packs. The full
// type lives in foundry-types, but only these fields matter for the browse list.
interface PackLike {
  collection: string
  documentName: string
  metadata: { label: string; packageName?: string }
}

export async function foundryListCompendia(args: ListCompendiaArgs) {
  const packs = getGame().packs as unknown as Iterable<PackLike>
  const compendia: CompendiumPackInfo[] = Array.from(packs).map((pack) => ({
    id: pack.collection,
    label: pack.metadata.label,
    documentType: pack.documentName,
    packageName: pack.metadata.packageName ?? ''
  }))
  return { ...makeAck(args), compendia }
}
