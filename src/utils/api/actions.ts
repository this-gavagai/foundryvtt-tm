import type { Actor } from '@/utils/pf2e-types'
import { useServer } from '@/composables/server'
import { pushToAckQueue } from './setup'

const { getSocket } = useServer()

export async function castSpell(
  actor: Actor,
  spellId: string,
  castingLevel: number,
  castingSlot: number
): Promise<any> {
  const socket = await getSocket()
  const uuid = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    socket.emit('module.tablemate', {
      action: 'castSpell',
      id: spellId,
      characterId: actor._id,
      rank: castingLevel,
      slotId: castingSlot,
      uuid: uuid
    })
    pushToAckQueue(uuid, (args: any) => resolve(args))
  })
}

export async function rollCheck(
  actor: Actor,
  checkType: string,
  checkSubtype = '',
  modifiers = [],
  options = {}
): Promise<any> {
  const socket = await getSocket()
  const uuid = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    socket.emit('module.tablemate', {
      action: 'rollCheck',
      characterId: actor._id,
      checkType,
      checkSubtype,
      modifiers,
      options,
      skipDialog: true,
      uuid
    })
    pushToAckQueue(uuid, (args: any) => resolve(args))
  })
}

export async function characterAction(
  actor: Actor,
  characterAction: string,
  options = {}
): Promise<any> {
  const socket = await getSocket()
  const uuid = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    socket.emit('module.tablemate', {
      action: 'characterAction',
      characterId: actor._id,
      characterAction,
      options,
      uuid
    })
    pushToAckQueue(uuid, (args: any) => resolve(args))
  })
}
