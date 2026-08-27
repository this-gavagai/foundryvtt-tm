import type { ListCompendiaArgs, CompendiumPackInfo } from '@/types/api-types'
import { getGame, makeAck } from '../utils/foundry'
import { getRequestingUser, userCanObservePack } from '../utils/permissions'

export async function foundryListCompendia(args: ListCompendiaArgs) {
  const source = getGame()
  const user = getRequestingUser(source, args.userId)
  if (!user) return { ...makeAck(args), compendia: [] }

  // Only advertise packs the requesting user may observe, so GM-only packs
  // never appear in the tablet's browse list.
  const compendia: CompendiumPackInfo[] = Array.from(source.packs)
    .filter((pack) => userCanObservePack(pack, user))
    .map((pack) => ({
      id: pack.collection,
      label: pack.metadata.label,
      documentType: pack.documentName,
      packageName: pack.metadata.packageName ?? ''
    }))
  return { ...makeAck(args), compendia }
}
