import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import type { TablemateActorRef } from '@/types/character-types'

// Hit points are the one actor field that does NOT take the direct
// modifyDocument path, because `preUpdateActor` — where module HP automation
// lives — fires only on a client that calls actor.update(). These specs pin the
// routing decision and the offline fallback.

const setHitPointsRpc = vi.hoisted(() => vi.fn(async () => ({})))
const updateActor = vi.hoisted(() => vi.fn(async () => ({})))
const isListening = vi.hoisted(() => ({ value: true }))
const supportsSetHitPoints = vi.hoisted(() => ({ value: true }))

vi.mock('@/api/actionRpc', () => ({ setHitPoints: setHitPointsRpc }))
vi.mock('@/api/documents', () => ({ updateActor }))
vi.mock('@/stores/listenersOnline', () => ({
  useListenersStore: () => ({
    get isListening() {
      return isListening.value
    }
  })
}))
vi.mock('@/stores/versionCompat', () => ({
  useVersionCompatStore: () => ({
    get supportsSetHitPoints() {
      return supportsSetHitPoints.value
    }
  })
}))

const { setHitPoints } = await import('@/composables/setHitPoints')

function actorRef(value = 20, temp = 0) {
  return ref({
    _id: 'seelah-id',
    system: { attributes: { hp: { value, max: 30, temp } } }
  }) as unknown as TablemateActorRef
}

const hpOf = (actor: TablemateActorRef) => actor.value!.system.attributes.hp

beforeEach(() => {
  setHitPointsRpc.mockClear()
  updateActor.mockClear()
  isListening.value = true
  supportsSetHitPoints.value = true
})

describe('setHitPoints', () => {
  it('hands the change to the GM when one is listening', async () => {
    const actor = actorRef()
    await setHitPoints(actor, { value: 12 })
    expect(setHitPointsRpc).toHaveBeenCalledWith(actor, { value: 12 })
    expect(updateActor).not.toHaveBeenCalled()
  })

  it('sends hit points and temporary hit points as one request', async () => {
    const actor = actorRef()
    await setHitPoints(actor, { value: 12, temp: 10 })
    expect(setHitPointsRpc).toHaveBeenCalledTimes(1)
    expect(setHitPointsRpc).toHaveBeenCalledWith(actor, { value: 12, temp: 10 })
  })

  it('writes directly when no GM is listening, rather than refusing the edit', async () => {
    isListening.value = false
    const actor = actorRef()
    await setHitPoints(actor, { value: 12 })
    expect(setHitPointsRpc).not.toHaveBeenCalled()
    expect(updateActor).toHaveBeenCalledWith(actor, {
      system: { attributes: { hp: { value: 12 } } }
    })
  })

  it('writes directly when the module is too old to have the handler', async () => {
    // Otherwise the request goes unanswered and the edit silently does nothing
    // after a 30s timeout.
    supportsSetHitPoints.value = false
    const actor = actorRef()
    await setHitPoints(actor, { value: 12 })
    expect(setHitPointsRpc).not.toHaveBeenCalled()
    expect(updateActor).toHaveBeenCalled()
  })

  it('updates the sheet optimistically on both paths', async () => {
    const online = actorRef()
    await setHitPoints(online, { value: 12, temp: 3 })
    expect(hpOf(online)).toMatchObject({ value: 12, temp: 3 })

    isListening.value = false
    const offline = actorRef()
    await setHitPoints(offline, { value: 7 })
    expect(hpOf(offline)).toMatchObject({ value: 7, temp: 0 })
  })

  it('leaves an omitted field untouched locally', async () => {
    const actor = actorRef(20, 5)
    await setHitPoints(actor, { value: 12 })
    expect(hpOf(actor)).toMatchObject({ value: 12, temp: 5 })
  })

  it('does nothing at all when neither field was asked for', async () => {
    await setHitPoints(actorRef(), {})
    expect(setHitPointsRpc).not.toHaveBeenCalled()
    expect(updateActor).not.toHaveBeenCalled()
  })
})
