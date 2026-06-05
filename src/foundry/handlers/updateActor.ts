import type { UpdateActorArgs } from '@/types/api-types'
import { getGame, makeAck } from '../utils/foundry'

export async function foundryUpdateActor(args: UpdateActorArgs) {
  const source = getGame()
  const ack = makeAck(args)
  const actor = source.actors.get(args.actorId, { strict: true })
  await actor.update(args.update as Record<string, unknown>)
  return ack
}
