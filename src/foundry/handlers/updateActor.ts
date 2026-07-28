import type { UpdateActorArgs } from '@/types/api-types'
import { logger } from '@/utils/utilities'
import { sanitizeActorUpdate } from '@/utils/actorUpdatePaths'
import { getGame, makeAck } from '../utils/foundry'

// Legacy UPDATE_ACTOR RPC handler. The app now writes its owned actor directly
// over the modifyDocument socket (api/documents.ts) and no longer sends this;
// it remains as a backward-compat shim for a stale PWA that hasn't refreshed.
// The write runs with GM rights, so it's sanitized against the shared allowlist
// (utils/actorUpdatePaths.ts) exactly as the direct path is client-side.
export async function foundryUpdateActor(args: UpdateActorArgs) {
  const source = getGame()
  const actor = source.actors.get(args.actorId, { strict: true })
  const { clean, dropped } = sanitizeActorUpdate(args.update as Record<string, unknown>)
  if (dropped.length) logger.warn('TM-UPDATE-ACTOR: dropped unpermitted paths', dropped)
  // An update with nothing left is a client/module mismatch or an attempted
  // privileged write — fail loudly instead of acking a write that never
  // happened.
  if (!Object.keys(clean).length) {
    throw new Error(`Update contains no permitted fields (dropped: ${dropped.join(', ')})`)
  }
  await actor.update(clean)
  return makeAck(args)
}
