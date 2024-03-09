import { mergeDeep } from '@/utils/utilities'
import { useServer } from '@/utils/server'

const { socket } = useServer()

export function requestCharacterDetails(actorId: string) {
  // this method needs to be debounced (and the data sent should be paired back significantly)
  socket.value.emit('module.tablemate', {
    action: 'requestCharacterDetails',
    actorId: actorId
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
      r.result.forEach((d: string) => {
        const item = actor.value.items.find((i: any) => i._id === d)
        if (item) {
          const index = actor.value.items.indexOf(item)
          console.log(index)
          actor.value.items.splice(index, 1)
        }
      })
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
      r.result.forEach((change: any) => {
        let item = actor.value.items.find((a: any) => a._id == change._id)
        mergeDeep(item, change)

        requestCharacterDetails(actor.value._id)
      })
    }
  )
}
