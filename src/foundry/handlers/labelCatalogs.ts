import type { GetLabelCatalogsArgs } from '@/types/api-types'
import { makeAck } from '../utils/foundry'
import { buildWorldLabelCatalogs, labelCatalogStamp } from '../utils/labels'

// Answer "what does this world call things?" — once, for the whole world.
//
// This is the read that replaces five maps on every character payload. It
// consults no actor and touches no document: the catalogs come out of
// CONFIG.PF2E and the world's locale, which is exactly why the app can cache the
// result against the returned stamp and stop asking.
//
// Cheap enough to answer on the concurrent lane (no dice, no chat, no ambient
// roll state), and it must be — the app asks for it the moment a listener
// appears, which is also when a sheet is most likely to be waiting on a roll.
export async function foundryGetLabelCatalogs(args: GetLabelCatalogsArgs) {
  return {
    ...makeAck(args),
    stamp: labelCatalogStamp(),
    catalogs: buildWorldLabelCatalogs()
  }
}
