import { mergeDeep } from '@/utils/utilities'
import { useServer } from '@/utils/server'
import { useThrottleFn } from '@vueuse/core'

const { socket } = useServer()

export const requestCharacterDetails = useThrottleFn(
  (actorId: string) => {
    socket.value.emit('module.tablemate', {
      action: 'requestCharacterDetails',
      actorId: actorId
    })
  },
  3000,
  true,
  true
)

export function setupSocketListenersForActor(actorId: string, actor: any) {
  // todo: is there any way to refactor this so both actorId and actor aren't needed? right now, need both because actor may be empty
  socket.value.on('module.tablemate', (args: any) => {
    switch (args.action) {
      case 'gmOnline':
        requestCharacterDetails(actorId)
        break
      case 'updateCharacterDetails':
        // this is super inefficient; there must be a more efficient way
        if (args.actorId === actorId) {
          actor.value = args.actor
          mergeDeep(actor.value.system, args.system)
          actor.value.feats = args.feats
          actor.value.inventory = args.inventory
          if (!window.actor) window.actor = actor.value
        }
        break
      default:
        console.log('roll not managed locally: ', args.action)
    }
  })
  socket.value.on('modifyDocument', (mods: any) => {
    switch (mods.request.type) {
      case 'Actor':
        mods.result.forEach((change: any) => {
          if (change._id === actor.value._id) {
            mergeDeep(actor.value, change)
          }
        })
        break
      case 'Item':
        // handle item types
        if (mods.request.parentUuid !== 'Actor.' + actorId) break
        switch (mods.request.action) {
          case 'update':
            _processUpdates(actor, mods.result)
            break
          case 'create':
            _processCreates(actor, mods.result)
            break
          case 'delete':
            _processDeletes(actor, mods.result)
            break
          default:
            console.log('item action not handled', mods.request.action)
        }
        break
      default:
        console.log('request type not handled', mods.request.action)
    }
  })
}

export function deleteActorItem(actor: any, itemId: string) {
  console.log(actor)
  socket.value.emit(
    'modifyDocument',
    {
      action: 'delete',
      type: 'Item',
      ids: [itemId],
      parentUuid: 'Actor.' + actor.value._id
    },
    (r: any) => {
      _processDeletes(actor, r.result)
      requestCharacterDetails(actor.value._id)
    }
  )
}

export function updateActorItem(
  actor: any,
  itemId: string,
  update: {},
  additionalOptions: {} | null
) {
  socket.value.emit(
    'modifyDocument',
    {
      action: 'update',
      type: 'Item',
      options: { diff: true, render: true, ...additionalOptions },
      parentUuid: 'Actor.' + actor.value._id,
      updates: [
        {
          _id: itemId,
          ...update
        }
      ]
    },
    (r: any) => {
      _processUpdates(actor, r.result)
      requestCharacterDetails(actor.value._id)
    }
  )
}

export function updateActor(actor: any, update: {}, additionalOptions: {} | null) {
  socket.value.emit(
    'modifyDocument',
    {
      action: 'update',
      type: 'Actor',
      options: { diff: true, render: true },
      updates: [
        {
          _id: actor.value._id,
          ...update
        }
      ]
    },
    (r: any) => {
      r.result.forEach((change: any) => {
        mergeDeep(actor.value, change)
      })
    }
  )
}

function _processDeletes(actor: any, results: []) {
  results.forEach((d: string) => {
    const item = actor.value.items.find((i: any) => i._id === d)
    if (item) {
      const index = actor.value.items.indexOf(item)
      actor.value.items.splice(index, 1)
    }
  })
}
function _processUpdates(actor: any, results: []) {
  results.forEach((change: any) => {
    let item = actor.value.items.find((a: any) => a._id == change._id)
    if (item) mergeDeep(item, change)
  })
}
function _processCreates(actor: any, results: []) {
  results.forEach((c: any) => {
    actor.value.items.push(c)
  })
}
