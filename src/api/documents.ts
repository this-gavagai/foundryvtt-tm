import type { Ref } from 'vue'
import { mergeWith } from 'lodash-es'
import type DocumentSocketResponse from '@7h3laughingman/foundry-types/common/abstract/socket.mjs'
import type { CharacterPF2e } from '@7h3laughingman/pf2e-types'
import {
  getSocket,
  mergeWithArrayReset,
  type ModifyDocumentUpdate,
  type DocumentData
} from './internal'
import { fireRefresh } from './characterSync'

// Foundry document collections that we mutate via the modifyDocument socket.
// Restricted to the set the app actually touches — typos for unsupported
// document types now fail at compile time.
export type DocumentType = 'Actor' | 'Item' | 'User' | 'Combat' | 'Combatant' | 'ChatMessage'

// Discriminated by `action`. Each variant constrains `operation` to the
// shape Foundry expects: create needs `data`, update needs `updates`,
// delete needs `ids`. Mismatches now fail at compile time instead of
// silently shipping a malformed payload.
export type ModifyDocumentPayload =
  | {
      action: 'create'
      type: DocumentType
      operation: {
        parentUuid?: string
        data: ModifyDocumentUpdate[]
        diff?: boolean
        render?: boolean
      }
    }
  | {
      action: 'update'
      type: DocumentType
      operation: {
        parentUuid?: string
        updates: ModifyDocumentUpdate[]
        diff?: boolean
        render?: boolean
      }
    }
  | {
      action: 'delete'
      type: DocumentType
      operation: {
        parentUuid?: string
        ids: string[]
      }
    }

export async function modifyDocument(
  payload: ModifyDocumentPayload,
  onResponse?: (r: DocumentSocketResponse) => void
): Promise<DocumentSocketResponse> {
  const socket = await getSocket()
  return new Promise<DocumentSocketResponse>((resolve) => {
    socket.emit('modifyDocument', payload, (r: DocumentSocketResponse) => {
      onResponse?.(r)
      resolve(r)
    })
  })
}

// Applies a modifyDocument response (create/update/delete) to a local
// document array in-place. Used both by document mutations (to reflect
// our own changes locally) and by socket listeners (to apply remote
// changes from other clients).
export function processChanges(args: DocumentSocketResponse, root: DocumentData[] | undefined) {
  if (!root) return
  switch (args.action as 'create' | 'update' | 'delete') {
    case 'create':
      ;(args.result as ModifyDocumentUpdate[]).forEach((c) => root.push(c))
      break
    case 'update':
      ;(args.result as ModifyDocumentUpdate[]).forEach((change) => {
        const item = root.find((a) => a._id === change._id)
        if (item) mergeWith(item, change, mergeWithArrayReset)
      })
      break
    case 'delete':
      ;(args.result as string[]).forEach((id) => {
        const i = root.findIndex((x) => x._id === id)
        if (i !== -1) root.splice(i, 1)
      })
      break
  }
}

export function updateActor(actor: Ref<CharacterPF2e>, update: object) {
  return modifyDocument(
    {
      action: 'update',
      type: 'Actor',
      operation: {
        diff: true,
        render: true,
        updates: [{ _id: actor.value._id!, ...update }]
      }
    },
    (r) => {
      ;(r.result as ModifyDocumentUpdate[]).forEach((change) => {
        mergeWith(actor.value, change, mergeWithArrayReset)
      })
      fireRefresh(actor.value._id)
    }
  )
}

export function updateActorItem(
  actor: Ref<CharacterPF2e>,
  itemId: string | string[],
  update: object | object[]
) {
  const itemIds = Array.isArray(itemId) ? itemId : [itemId]
  return modifyDocument(
    {
      action: 'update',
      type: 'Item',
      operation: {
        diff: true,
        render: true,
        parentUuid: 'Actor.' + actor.value._id!,
        updates: itemIds.map((id, i) => ({
          _id: id,
          ...(Array.isArray(update) ? update[i] : update)
        }))
      }
    },
    (r) => {
      processChanges(r, actor.value.items as unknown as DocumentData[])
      fireRefresh(actor.value._id)
    }
  )
}

export function deleteActorItem(actor: Ref<CharacterPF2e>, itemId: string) {
  return modifyDocument(
    {
      action: 'delete',
      type: 'Item',
      operation: {
        ids: [itemId],
        parentUuid: 'Actor.' + actor.value._id!
      }
    },
    (r) => {
      processChanges(r, actor.value.items as unknown as DocumentData[])
      fireRefresh(actor.value._id)
    }
  )
}

export function updateUserTargetingProxy(userId: string, proxyId: string) {
  return modifyDocument({
    action: 'update',
    type: 'User',
    operation: {
      updates: [{ _id: userId, flags: { tablemate: { targeting_proxy: proxyId } } }]
    }
  })
}
