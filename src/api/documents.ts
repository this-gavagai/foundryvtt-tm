import { mergeWith } from 'lodash-es'
import type DocumentSocketResponse from '@7h3laughingman/foundry-types/common/abstract/socket.mjs'
import type { TablemateActorRef } from '@/types/character-types'
import {
  getSocket,
  mergeWithArrayReset,
  asDocumentArray,
  type ModifyDocumentUpdate,
  type DocumentData
} from './internal'
import { fireRefresh } from './characterSync'
import { updateActorRemote } from './actionRpc'
import { useListenersStore } from '@/stores/listenersOnline'

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
        data: Record<string, unknown>[]
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

// Foundry answers a successful create/update/delete with a `result` array. A
// denied or failed operation answers without one — iterating it (as onResponse
// does) would throw inside the socket callback and leave the promise pending.
// And if the socket drops before any answer, the ack callback never fires at
// all. Both are handled below: a missing/invalid result rejects (skipping the
// apply callback), and a timeout rejects rather than hanging forever.
const MODIFY_DOCUMENT_TIMEOUT_MS = 15_000

export async function modifyDocument(
  payload: ModifyDocumentPayload,
  onResponse?: (r: DocumentSocketResponse) => void
): Promise<DocumentSocketResponse> {
  const socket = await getSocket()
  const label = `${payload.action} ${payload.type}`
  return new Promise<DocumentSocketResponse>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`modifyDocument ${label} timed out after ${MODIFY_DOCUMENT_TIMEOUT_MS}ms`))
    }, MODIFY_DOCUMENT_TIMEOUT_MS)

    socket.emit('modifyDocument', payload, (r: DocumentSocketResponse) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (!Array.isArray((r as { result?: unknown })?.result)) {
        const detail = (r as { error?: unknown })?.error ?? r
        reject(new Error(`modifyDocument ${label} failed: ${JSON.stringify(detail)}`))
        return
      }
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
      ;(args.result as ModifyDocumentUpdate[]).forEach((c) => {
        if (!root.find((x) => x._id === c._id)) root.push(c)
      })
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

export function updateActor(actor: TablemateActorRef, update: object) {
  if (useListenersStore().isListening) {
    return updateActorRemote(actor.value!._id!, update).then(() => {
      fireRefresh(actor.value!._id)
      return null
    })
  }
  return modifyDocument(
    {
      action: 'update',
      type: 'Actor',
      operation: {
        diff: true,
        render: true,
        updates: [{ _id: actor.value!._id!, ...update }]
      }
    },
    (r) => {
      ;(r.result as ModifyDocumentUpdate[]).forEach((change) => {
        mergeWith(actor.value!, change, mergeWithArrayReset)
      })
      fireRefresh(actor.value!._id)
    }
  )
}

export function updateActorItem(
  actor: TablemateActorRef,
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
        parentUuid: 'Actor.' + actor.value!._id!,
        updates: itemIds.map((id, i) => ({
          _id: id,
          ...(Array.isArray(update) ? update[i] : update)
        }))
      }
    },
    (r) => {
      processChanges(r, asDocumentArray(actor.value!.items))
      fireRefresh(actor.value!._id)
    }
  )
}

export function deleteActorItem(actor: TablemateActorRef, itemId: string) {
  return modifyDocument(
    {
      action: 'delete',
      type: 'Item',
      operation: {
        ids: [itemId],
        parentUuid: 'Actor.' + actor.value!._id!
      }
    },
    (r) => {
      processChanges(r, asDocumentArray(actor.value!.items))
      fireRefresh(actor.value!._id)
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
