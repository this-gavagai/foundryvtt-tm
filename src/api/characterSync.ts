import type { Ref } from 'vue'
import { mergeWith } from 'lodash-es'
import type { TablemateCharacter } from '@/types/character-types'
import type { UpdateCharacterDetailsArgs } from '@/types/api-types'
import { uuidv4 } from '@/utils/utilities'
import { getSocket, getUserId, mergeWithArrayReset } from './internal'
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

export async function sendCharacterRequest(actorId: string): Promise<void> {
  const socket = await getSocket()
  const userId = getUserId()
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
  actor: Ref<TablemateCharacter | undefined>,
  args: UpdateCharacterDetailsArgs
) {
  if (actorId !== args.actorId) return
  if (characterUnsynced.get(actorId)) return
  if (characterLastRequest.get(actorId) !== args.uuid) return

  if (!actor.value) actor.value = {} as TablemateCharacter

  // Pull `items` out before the generic merge. Items are an ID-keyed collection;
  // merging them by array position triggers false length-mismatch warnings whenever
  // items are deleted. We handle them below with an explicit ID-based merge instead.
  const { items: incomingItems, ...actorWithoutItems } = (args.actor ?? {}) as {
    items?: { _id?: string }[]
    [key: string]: unknown
  }

  const incoming: Partial<TablemateCharacter> = {
    ...(actorWithoutItems as Partial<TablemateCharacter>),
    system: args.system as TablemateCharacter['system'],
    languages: args.languages,
    proficiencyLabels: args.proficiencyLabels,
    elementalBlasts: (args.elementalBlasts ?? undefined) as TablemateCharacter['elementalBlasts'],
    inventory: args.inventory as TablemateCharacter['inventory'],
    activeRules: args.activeRules,
    spellcastingModifiers: args.spellcastingModifiers as TablemateCharacter['spellcastingModifiers'],
    rollOptionLabels: args.rollOptionLabels,
    iwrLabels: args.iwrLabels
  }

  mergeWith(actor.value, incoming, mergeWithArrayReset)

  // ID-based merge for items: deep-merge matching items, remove missing ones,
  // append genuinely new ones. Avoids position-based array merging entirely.
  if (incomingItems) {
    const existing = actor.value.items as unknown as { _id?: string }[] | undefined
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
}
