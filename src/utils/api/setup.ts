import type { Ref } from 'vue'
import type { Actor } from '@/utils/pf2e-types'
import { useThrottleFn } from '@vueuse/core'

import { merge } from 'lodash-es'
import { useServer } from '@/composables/server'
import { _processCreates, _processUpdates, _processDeletes } from './_helpers'

const { getSocket } = useServer()
const ackQueue: { [key: string]: Function } = {}
export function pushToAckQueue(uuid: string, callback: Function) {
  ackQueue[uuid] = callback
}

export async function setupSocketListenersForActor(actorId: string, actor: Ref<Actor | undefined>) {
  const socket = await getSocket()
  socket.on('module.tablemate', (args: any) => {
    switch (args.action) {
      case 'gmOnline':
        requestCharacterDetails(actorId)
        break
      case 'updateCharacterDetails':
        if (args.actorId === actorId) {
          actor.value = args.actor
          merge(actor.value!.system, args.system)
          actor.value!.feats = args.feats
        }
        break
      case 'acknowledged':
        if (ackQueue[args.uuid]) {
          ackQueue[args.uuid](args)
          delete ackQueue[args.uuid]
        }
        break
      default:
        console.log('action not managed locally: ', args.action)
    }
  })
  socket.on('modifyDocument', (mods: any) => {
    switch (mods.request.type) {
      case 'Actor':
        mods.result.forEach((change: any) => {
          if (actor && change._id === actor.value?._id) {
            merge(actor.value, change)
          }
        })
        if (actor.value) requestCharacterDetails(actor.value!._id!)
        break
      case 'Item':
        // handle item types
        if (mods.request.parentUuid !== 'Actor.' + actorId) break
        if (!actor.value) break
        switch (mods.request.action) {
          case 'update':
            _processUpdates(actor as Ref<Actor>, mods.result)
            break
          case 'create':
            _processCreates(actor as Ref<Actor>, mods.result)
            break
          case 'delete':
            _processDeletes(actor as Ref<Actor>, mods.result)
            break
          default:
            console.log('item action not handled', mods.request.action, mods)
        }
        break
      case 'Combat':
      case 'Combatant':
        console.log('combat input')
      case 'ChatMessage':
        break
      default:
        console.log('request type not handled', mods.request.action, mods)
    }
  })
}
async function sendCharacterRequest(actorId: string): Promise<any> {
  const socket = await getSocket()
  const uuid = crypto.randomUUID()
  const promise = new Promise((resolve, reject) => {
    socket.emit('module.tablemate', {
      action: 'requestCharacterDetails',
      actorId: actorId,
      uuid
    })
    // ackQueue[uuid] = (args: any) => resolve(args)
    pushToAckQueue(uuid, (args: any) => resolve(args))
  })
  return promise
}
export const requestCharacterDetails = useThrottleFn(sendCharacterRequest, 3000, true, true)
