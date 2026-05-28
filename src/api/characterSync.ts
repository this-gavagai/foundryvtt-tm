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

  const incoming: Partial<TablemateCharacter> = {
    ...(args.actor as Partial<TablemateCharacter>),
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
}
