import type { Ref } from 'vue'
import type { Actor } from '@/utils/pf2e-types'
import { useServer } from '@/composables/server'
import { _processCreates, _processUpdates, _processDeletes } from './_helpers'
import { merge } from 'lodash-es'
// import * as _ from 'lodash-es'

const { getSocket } = useServer()

export async function updateActor(
  actor: Ref<Actor>,
  update: {},
  additionalOptions: null | { [key: string]: any } = null
): Promise<any> {
  const socket = await getSocket()
  const promise = new Promise((resolve, reject) => {
    socket.emit(
      'modifyDocument',
      {
        action: 'update',
        type: 'Actor',
        options: { diff: true, render: true, ...additionalOptions },
        updates: [
          {
            _id: actor.value._id,
            ...update
          }
        ]
      },
      (r: any) => {
        r.result.forEach((change: any) => {
          merge(actor.value, change)
        })
        resolve(r)
      }
    )
  })
  return promise
}

export async function updateActorItem(
  actor: Ref<Actor>,
  itemId: string,
  update: {},
  additionalOptions: null | { [key: string]: any } = null
): Promise<any> {
  const socket = await getSocket()
  const promise = new Promise((resolve, reject) => {
    socket.emit(
      'modifyDocument',
      {
        action: 'update',
        type: 'Item',
        options: { diff: true, render: true, ...additionalOptions },
        parentUuid: 'Actor.' + actor.value?._id,
        updates: [
          {
            _id: itemId,
            ...update
          }
        ]
      },
      (r: any) => {
        _processUpdates(actor, r.result)
        resolve(r)
      }
    )
  })
  return promise
}

export async function deleteActorItem(actor: Ref<Actor>, itemId: string): Promise<any> {
  const socket = await getSocket()
  const promise = new Promise((resolve, reject) => {
    socket.emit(
      'modifyDocument',
      {
        action: 'delete',
        type: 'Item',
        ids: [itemId],
        parentUuid: 'Actor.' + actor.value?._id
      },
      (r: any) => {
        _processDeletes(actor, r.result)
        resolve(r)
      }
    )
  })
  return promise
}
