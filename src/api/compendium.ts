import type { Socket } from 'socket.io-client'
import type {
  CompendiumIndexEntry,
  CompendiumItemData,
  CompendiumPackInfo
} from '@/types/api-types'
import { getSocket } from './internal'
import { requireStoreBridge } from './storeBridge'
import { logger } from '@/utils/utilities'
import {
  CORE_INDEX_FIELDS,
  EXTRA_INDEX_FIELDS,
  listVisiblePacks,
  parseCompendiumUuid,
  parseEmbeddedItemUuid,
  shapeCompendiumItem,
  shapeIndexEntries,
  type PackMetadataLike
} from '@/utils/compendiumData'

// Read compendia DIRECTLY over the app's own authenticated socket, using
// Foundry's native database `get` (the same modifyDocument event, action:'get',
// that ClientDatabaseBackend._getDocuments sends). Replaces the LIST_COMPENDIA /
// GET_COMPENDIUM_INDEX / GET_COMPENDIUM_ITEM RPCs — no GM proxy required.
//
// Permission note: Foundry's server does NOT enforce compendium read
// permission (unlike create/update/delete), so any pack is readable here. The
// pack list is filtered client-side (listVisiblePacks) purely to match what a
// player sees in Foundry's UI — it's cosmetic, not a security boundary. This is
// the same exposure a player already has via Foundry's own console.

const COMPENDIUM_GET_TIMEOUT_MS = 15_000

interface DatabaseGetResponse {
  result?: unknown[]
  error?: unknown
}

// Emit one Foundry database `get`. Mirrors the request ClientDatabaseBackend
// builds: { type, action:'get', operation }. Rejects on a missing/failed result
// (a get answers with a `result` array; a server error answers without one).
function socketDatabaseGet(request: {
  type: string
  pack: string
  index: boolean
  query: Record<string, unknown>
  indexFields?: string[]
}): Promise<unknown[]> {
  return getSocket().then(
    (socket: Socket) =>
      new Promise<unknown[]>((resolve, reject) => {
        const payload = {
          type: request.type,
          action: 'get',
          operation: {
            action: 'get',
            pack: request.pack,
            index: request.index,
            ...(request.indexFields ? { indexFields: request.indexFields } : {}),
            query: request.query,
            broadcast: false
          }
        }
        const timer = setTimeout(
          () => reject(new Error(`compendium get (${request.pack}) timed out`)),
          COMPENDIUM_GET_TIMEOUT_MS
        )
        socket.emit('modifyDocument', payload, (r: DatabaseGetResponse) => {
          clearTimeout(timer)
          if (!Array.isArray(r?.result)) {
            const detail = r?.error ?? r
            reject(new Error(`compendium get (${request.pack}) failed: ${JSON.stringify(detail)}`))
            return
          }
          resolve(r.result)
        })
      })
  )
}

function worldPacks(): PackMetadataLike[] {
  return requireStoreBridge().getWorldPacks() as PackMetadataLike[]
}

function findPack(packId: string): PackMetadataLike | undefined {
  return worldPacks().find((meta) => (meta.id ?? meta.collection) === packId)
}

// List the packs this user may browse, read from the world payload (no socket
// round-trip — pack metadata already ships with the world). Shape/response
// mirror the old LIST_COMPENDIA RPC so callers are unchanged.
export function listCompendia(): Promise<{ compendia: CompendiumPackInfo[] }> {
  const compendia = listVisiblePacks(worldPacks(), requireStoreBridge().getUserRole())
  return Promise.resolve({ compendia })
}

export async function getCompendiumIndex(
  packId: string
): Promise<{ compendiumIndex: CompendiumIndexEntry[] }> {
  const pack = findPack(packId)
  const documentType = pack?.type ?? pack?.documentName
  if (!documentType) {
    logger.warn('TM-COMPENDIUM: unknown pack, cannot resolve document type', packId)
    return { compendiumIndex: [] }
  }
  const raw = await socketDatabaseGet({
    type: documentType,
    pack: packId,
    index: true,
    indexFields: [...CORE_INDEX_FIELDS, ...EXTRA_INDEX_FIELDS],
    query: {}
  })
  return { compendiumIndex: shapeIndexEntries(raw as never[], packId, documentType) }
}

// Resolve an actor-embedded item (Actor.<id>.Item.<id>) from the loaded world
// payload — world actors ship with their items, so no socket round-trip is
// needed. Shaped exactly like a compendium hit, with the owning actor's name
// standing in for the pack label.
function embeddedItem(actorId: string, itemId: string): CompendiumItemData | null {
  const actor = requireStoreBridge().getWorldActor(actorId) as
    | { name?: string; items?: Array<{ _id?: string }> }
    | undefined
  const item = actor?.items?.find((candidate) => candidate._id === itemId)
  if (!item) return null
  return shapeCompendiumItem(item, actor?.name ?? '')
}

// Resolve just the display name behind a UUID, for label-less @UUID[...] links.
//
// Reads the pack INDEX rather than the document: a name is all the caller wants,
// and a chat log can carry dozens of these links (a PF2e daily-preparations card
// lists every prepared spell), so pulling whole spell documents — description
// HTML, rules elements and all — to read one field would be wasteful on a phone.
export async function getCompendiumName(itemUuid: string): Promise<string | undefined> {
  const embedded = parseEmbeddedItemUuid(itemUuid)
  if (embedded) return embeddedItem(embedded.actorId, embedded.itemId)?.name

  const ref = parseCompendiumUuid(itemUuid)
  if (!ref) {
    logger.warn('TM-COMPENDIUM: not a compendium uuid', itemUuid)
    return undefined
  }
  const raw = await socketDatabaseGet({
    type: ref.documentType,
    pack: ref.packId,
    index: true,
    indexFields: ['_id', 'name'],
    query: { _id: ref.id }
  })
  const name = (raw[0] as { name?: unknown } | undefined)?.name
  if (typeof name !== 'string' || !name) {
    logger.warn('TM-COMPENDIUM: could not resolve name for', itemUuid)
    return undefined
  }
  return name
}

// Read a linked document by UUID: a compendium entry (over the socket) or an
// item embedded on a world actor (straight from the world payload).
export async function getCompendiumItem(
  itemUuid: string
): Promise<{ compendiumItem: CompendiumItemData | null }> {
  const embedded = parseEmbeddedItemUuid(itemUuid)
  if (embedded) {
    const compendiumItem = embeddedItem(embedded.actorId, embedded.itemId)
    if (!compendiumItem) logger.warn('TM-COMPENDIUM: could not resolve actor item', itemUuid)
    return { compendiumItem }
  }

  const ref = parseCompendiumUuid(itemUuid)
  if (!ref) {
    logger.warn('TM-COMPENDIUM: not a compendium uuid', itemUuid)
    return { compendiumItem: null }
  }
  const raw = await socketDatabaseGet({
    type: ref.documentType,
    pack: ref.packId,
    index: false,
    query: { _id: ref.id }
  })
  const doc = raw[0]
  if (!doc) {
    logger.warn('TM-COMPENDIUM: could not resolve', itemUuid)
    return { compendiumItem: null }
  }
  const packLabel = findPack(ref.packId)?.label ?? ref.packId
  return { compendiumItem: shapeCompendiumItem(doc, packLabel) }
}
