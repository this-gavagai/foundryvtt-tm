import type { Ref } from 'vue'
import type { Actor } from '@/utils/pf2e-types'
import { useServer } from '@/composables/server'
import { pushToAckQueue } from './setup'

const { getSocket } = useServer()

export async function castSpell(
  actor: Ref<Actor>,
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
      characterId: actor.value._id,
      rank: castingLevel,
      slotId: castingSlot,
      uuid: uuid
    })
    pushToAckQueue(uuid, (args: any) => resolve(args))
  })
}

export async function rollCheck(
  actor: Ref<Actor>,
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
      characterId: actor.value._id,
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
  actor: Ref<Actor>,
  characterAction: string,
  options = {}
): Promise<any> {
  const socket = await getSocket()
  const uuid = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    socket.emit('module.tablemate', {
      action: 'characterAction',
      characterId: actor.value._id,
      characterAction,
      options,
      uuid
    })
    pushToAckQueue(uuid, (args: any) => resolve(args))
  })
}
