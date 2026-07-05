import type { UpdateActorArgs } from '@/types/api-types'
import { logger } from '@/utils/utilities'
import { getGame, makeAck } from '../utils/foundry'

// The update runs with GM rights, so a naive `actor.update(args.update)` lets an
// owner write fields Foundry normally reserves — most dangerously `ownership`
// (grant/revoke access), plus identity/token fields the app never touches.
// Strip those roots (matched against both nested keys and dot-notation paths)
// while leaving the character-state fields the app actually edits (hp,
// resources, conditions, flags, etc.) untouched.
const BLOCKED_UPDATE_ROOTS = new Set(['ownership', 'permission', 'prototypeToken', '_id', 'type'])

function sanitizeActorUpdate(update: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  const dropped: string[] = []
  for (const [key, value] of Object.entries(update)) {
    if (BLOCKED_UPDATE_ROOTS.has(key.split('.')[0])) {
      dropped.push(key)
      continue
    }
    clean[key] = value
  }
  if (dropped.length) logger.warn('TM-UPDATE-ACTOR: dropped privileged keys', dropped)
  return clean
}

export async function foundryUpdateActor(args: UpdateActorArgs) {
  const source = getGame()
  const ack = makeAck(args)
  const actor = source.actors.get(args.actorId, { strict: true })
  await actor.update(sanitizeActorUpdate(args.update as Record<string, unknown>))
  return ack
}
