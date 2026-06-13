import type { Ref } from 'vue'
import { mergeWith } from 'lodash-es'
import type { TablemateActor } from '@/types/character-types'
import type { UpdateCharacterDetailsArgs } from '@/types/api-types'
import { debounce } from 'lodash-es'
import { uuidv4 } from '@/utils/utilities'
import { saveActorSnapshot } from '@/utils/actorCache'
import { getAuthenticatedSocket, mergeWithArrayReset, asDocumentArray } from './internal'
import { TM } from './protocol'

// Per-actor dirty flag and last-sent request UUID — used by parseActorData
// to ignore stale or unrelated update responses.
const characterUnsynced = new Map<string, boolean>()
const characterLastRequest = new Map<string, string>()

// Refresh-callback registry: components register a refresh() they want
// invoked whenever an actor's state changes server-side.
const refreshCallbacks: { [actorId: string]: Set<() => void> } = {}

export function addRefresh(actorId: string, fn: () => void): () => void {
  ;(refreshCallbacks[actorId] ??= new Set()).add(fn)
  return () => {
    refreshCallbacks[actorId]?.delete(fn)
    if (refreshCallbacks[actorId]?.size === 0) delete refreshCallbacks[actorId]
  }
}

export function fireRefresh(actorId: string | null | undefined) {
  if (!actorId) return
  refreshCallbacks[actorId]?.forEach((fn) => fn())
}

// Fan out a refresh to every registered actor — used on socket reconnect to
// catch up on changes missed while the connection was gapped. Without this,
// soft reconnects (socket.io's internal retry) leave actor data stale until
// the user manually does something that triggers a re-fetch.
export function fireAllRefresh() {
  Object.keys(refreshCallbacks).forEach(fireRefresh)
}

export const setCharUnsynced = (actorId: string, value: boolean) =>
  characterUnsynced.set(actorId, value)
export const isCharUnsynced = (actorId: string) => characterUnsynced.get(actorId) ?? false

// Fresh-data registry: fires whenever a full server payload has been merged
// into an actor, so the UI can drop the "showing cached snapshot" hint and
// the snapshot cache can be refreshed. Distinct from refreshCallbacks (which
// fire to *request* a refetch); these fire once the refetch has landed.
const freshCallbacks: { [actorId: string]: Set<() => void> } = {}

export function onActorFresh(actorId: string, fn: () => void): () => void {
  ;(freshCallbacks[actorId] ??= new Set()).add(fn)
  return () => {
    freshCallbacks[actorId]?.delete(fn)
    if (freshCallbacks[actorId]?.size === 0) delete freshCallbacks[actorId]
  }
}

// Persist the merged snapshot on a trailing-edge debounce so a burst of
// updates (e.g. several modifyDocument deltas) collapses into one IDB write.
// The debounce is *per actor* — a single shared debounce would coalesce
// concurrent saves across characters and only ever persist the last one, so
// with multiple owned actors all but one would silently fail to cache.
const saveDebouncers = new Map<string, ReturnType<typeof debounce<typeof saveActorSnapshot>>>()
function queueSnapshotSave(actorId: string, actor: Parameters<typeof saveActorSnapshot>[1]) {
  let save = saveDebouncers.get(actorId)
  if (!save) {
    save = debounce(saveActorSnapshot, 1000, { trailing: true })
    saveDebouncers.set(actorId, save)
  }
  save(actorId, actor)
}

export async function sendCharacterRequest(actorId: string): Promise<void> {
  const { socket, userId } = await getAuthenticatedSocket()
  const uuid = uuidv4()
  socket.emit(TM.CHANNEL, {
    userId,
    action: TM.REQUEST_CHARACTER,
    actorId: actorId,
    uuid
  })
  characterUnsynced.set(actorId, false)
  characterLastRequest.set(actorId, uuid)
}

export function parseActorData(
  actorId: string,
  actor: Ref<TablemateActor | undefined>,
  args: UpdateCharacterDetailsArgs
) {
  if (actorId !== args.actorId) return
  if (characterUnsynced.get(actorId)) return
  if (characterLastRequest.get(actorId) !== args.uuid) return

  if (!actor.value) actor.value = {} as TablemateActor

  // Pull `items` out before the generic merge. Items are an ID-keyed collection;
  // merging them by array position triggers false length-mismatch warnings whenever
  // items are deleted. We handle them below with an explicit ID-based merge instead.
  const { items: incomingItems, ...actorWithoutItems } = (args.actor ?? {}) as {
    items?: { _id?: string }[]
    [key: string]: unknown
  }

  const incoming = {
    ...(actorWithoutItems as Partial<TablemateActor>),
    system: args.system,
    languages: args.languages,
    proficiencyLabels: args.proficiencyLabels,
    elementalBlasts: args.elementalBlasts ?? undefined,
    inventory: args.inventory,
    activeRules: args.activeRules,
    spellcastingModifiers: args.spellcastingModifiers,
    rollOptionLabels: args.rollOptionLabels,
    iwrLabels: args.iwrLabels
  } as Partial<TablemateActor>

  mergeWith(actor.value, incoming, mergeWithArrayReset)

  // ID-based merge for items: deep-merge matching items, remove missing ones,
  // append genuinely new ones. Avoids position-based array merging entirely.
  if (incomingItems) {
    const existing = asDocumentArray(actor.value.items) as { _id?: string }[]
    if (!existing) {
      ;(actor.value as { items: unknown }).items = incomingItems
    } else {
      const incomingById = new Map(incomingItems.map((i) => [i._id, i]))
      for (let i = existing.length - 1; i >= 0; i--) {
        const match = incomingById.get(existing[i]._id)
        if (!match) existing.splice(i, 1)
        else mergeWith(existing[i], match, mergeWithArrayReset)
      }
      const existingIds = new Set(existing.map((i) => i._id))
      for (const item of incomingItems) {
        if (!existingIds.has(item._id)) existing.push(item as never)
      }
    }
  }

  // Live data has landed: clear any "showing cached" hint and refresh the
  // persisted snapshot for the next cold start.
  freshCallbacks[actorId]?.forEach((fn) => fn())
  queueSnapshotSave(actorId, actor.value)
}
