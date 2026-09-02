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
import { sanitizeActorUpdate } from '@/utils/actorUpdatePaths'
import {
  GrantRestrictionError,
  resolveGrantDeletions,
  type GrantAwareItem
} from '@/utils/itemGrants'
import { logger } from '@/utils/utilities'

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

// Every writable field in the character model mutates the local document
// optimistically before the write is sent, so a failed write (GM offline,
// permission denied, timeout) leaves the sheet showing state the server never
// accepted. Recover by re-requesting server truth (fire the actor's refresh
// so registered sheets re-fetch), then RE-THROW: callers legitimately depend
// on observing the failure — EquipmentList's transfer abort, the strike
// damage-type toggle gate, the button seam's failure flash. Fire-and-forget
// computed setters swallow the re-throw explicitly at their call sites.
export function recoverFailedWrite(actor: TablemateActorRef, error: unknown): never {
  logger.warn('TM-WARN: actor write failed; refreshing from server state', error)
  fireRefresh(actor.value?._id)
  throw error
}

// Write the app's owned actor DIRECTLY over the modifyDocument socket, as its
// own Foundry user, rather than asking the GM proxy to run actor.update (the
// old UPDATE_ACTOR RPC). Works with no GM online and skips the proxy round-trip.
// The update is sanitized against the shared allowlist first
// (utils/actorUpdatePaths.ts) so a buggy over-broad update can't write fields
// Foundry's owner-permission model would otherwise permit — the same guard the
// RPC handler applied, now enforced on every write instead of only when a GM
// was online to run it.
export function updateActor(actor: TablemateActorRef, update: object) {
  const { clean, dropped } = sanitizeActorUpdate(update as Record<string, unknown>)
  if (dropped.length) logger.warn('TM-UPDATE-ACTOR: dropped unpermitted paths', dropped)
  // Nothing left to write means a missing allowlist entry (a new editable field
  // wasn't registered) — surface it as a failure rather than a silent no-op, so
  // it's caught in development. Routed through recoverFailedWrite for one refresh
  // + rethrow path shared with a rejected socket write.
  if (!Object.keys(clean).length) {
    return Promise.resolve().then(() =>
      recoverFailedWrite(
        actor,
        new Error(`Actor update contains no permitted fields (dropped: ${dropped.join(', ')})`)
      )
    )
  }
  return modifyDocument(
    {
      action: 'update',
      type: 'Actor',
      operation: {
        diff: true,
        render: true,
        updates: [{ _id: actor.value!._id!, ...clean }]
      }
    },
    (r) => {
      ;(r.result as ModifyDocumentUpdate[]).forEach((change) => {
        mergeWith(actor.value!, change, mergeWithArrayReset)
      })
      fireRefresh(actor.value!._id)
    }
  ).catch((error) => recoverFailedWrite(actor, error))
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
  ).catch((error) => recoverFailedWrite(actor, error))
}

// Drop a dangling `flags.pf2e.grantedBy` from items that outlive their granter.
// Sent as Foundry's `-=` deletion key, which removes the property outright
// rather than leaving a half-object behind. processChanges can't express a key
// removal through lodash merge, so the local mirror is edited directly instead.
function detachGrantedBy(actor: TablemateActorRef, itemIds: string[]) {
  if (!itemIds.length) return Promise.resolve()
  return modifyDocument(
    {
      action: 'update',
      type: 'Item',
      operation: {
        // Not diffed: a `-=` key has no counterpart in the current data, and
        // the point of sending it is that it survives to the server intact.
        diff: false,
        render: true,
        parentUuid: 'Actor.' + actor.value!._id!,
        updates: itemIds.map((id) => ({ _id: id, flags: { pf2e: { '-=grantedBy': null } } }))
      }
    },
    () => {
      const items = (asDocumentArray(actor.value?.items) ?? []) as GrantAwareItem[]
      for (const id of itemIds) {
        const pf2e = items.find((i) => i._id === id)?.flags?.pf2e
        if (pf2e) delete pf2e.grantedBy
      }
    }
  )
}

// Delete one or more of an actor's items, following PF2e's item-grant graph on
// the way out. The app deletes over the raw modifyDocument socket, so none of
// the system's client-side `ItemPF2e.deleteDocuments` logic runs — without this
// expansion, removing Dying left the Unconscious and Blinded it granted behind
// (adding chained fine, because that path goes through the GM's Foundry client).
// utils/itemGrants reads the relationship straight off the flags PF2e wrote; no
// condition is named anywhere.
export function deleteActorItem(actor: TablemateActorRef, itemId: string | string[]) {
  const requested = Array.isArray(itemId) ? itemId : [itemId]
  const items = (asDocumentArray(actor.value?.items) ?? []) as GrantAwareItem[]
  const plan = resolveGrantDeletions(items, requested)

  // PF2e marks some grants `restrict`: Unconscious can't be dismissed while
  // Dying is what's causing it. Refuse the same way the system's own sheet
  // does, and don't refresh — nothing was written.
  if (plan.blocked.length) {
    logger.warn('TM-DELETE-ITEM: removal prevented by a granting item', plan.blocked)
    return Promise.reject(new GrantRestrictionError(plan.blocked))
  }
  // An id the local item list doesn't know about (a sheet mid-load, a subitem)
  // resolves to nothing — fall back to deleting exactly what was asked for
  // rather than silently deleting nothing.
  const ids = plan.deleteIds.length ? plan.deleteIds : requested

  return detachGrantedBy(actor, plan.detachIds)
    .then(() =>
      modifyDocument(
        {
          action: 'delete',
          type: 'Item',
          operation: {
            ids,
            parentUuid: 'Actor.' + actor.value!._id!
          }
        },
        (r) => {
          processChanges(r, asDocumentArray(actor.value!.items))
          fireRefresh(actor.value!._id)
        }
      )
    )
    .catch((error) => recoverFailedWrite(actor, error))
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
