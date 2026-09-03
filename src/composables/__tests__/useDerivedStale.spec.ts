import { describe, it, expect, beforeEach } from 'vitest'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useDerivedStale } from '@/composables/useDerivedStale'
import { useSyncStatusStore } from '@/stores/syncStatus'
import { useListenersStore } from '@/stores/listenersOnline'

// A direct socket write is GM-free for the write and not for its consequences:
// AC, bulk, the strikes list and spell DCs are all computed by PF2e on a real
// client, and only refreshed when the elected GM answers. With none listening
// that answer never comes and the sheet keeps showing pre-write figures.
//
// Both halves of the condition are what these pin, because getting either wrong
// makes the marker lie in a different direction:
//
//   * without "a refresh is outstanding", a sheet that has simply been sitting
//     there with the GM away marks everything stale — false, since those
//     figures are correct as of the last payload;
//   * without "no listener", every ordinary write would flicker the marker for
//     the fraction of a second before the GM answers, which is worse than
//     saying nothing at all.

let actorId = ref<string | undefined>('seelah')

function listening(yes: boolean) {
  const listeners = useListenersStore()
  if (yes) listeners.addListener('gm-1')
  else listeners.reset()
}

beforeEach(() => {
  setActivePinia(createPinia())
  actorId = ref<string | undefined>('seelah')
})

describe('useDerivedStale', () => {
  it('is false with nothing outstanding and a GM listening', () => {
    listening(true)
    expect(useDerivedStale(actorId).value).toBe(false)
  })

  it('is true once a refresh is outstanding and no GM can answer it', () => {
    listening(false)
    useSyncStatusStore().markAwaitingRefresh('seelah')

    expect(useDerivedStale(actorId).value).toBe(true)
  })

  // The GM is a fraction of a second away; marking here would flicker on every
  // write the app makes.
  it('is false while a GM is listening, even with a refresh outstanding', () => {
    listening(true)
    useSyncStatusStore().markAwaitingRefresh('seelah')

    expect(useDerivedStale(actorId).value).toBe(false)
  })

  // The figures on screen are correct as of the last payload. Marking them
  // because the GM happens to be away would be false.
  it('is false with no GM but nothing outstanding', () => {
    listening(false)
    expect(useDerivedStale(actorId).value).toBe(false)
  })

  it('clears when a payload finally lands', () => {
    listening(false)
    const sync = useSyncStatusStore()
    sync.markAwaitingRefresh('seelah')
    const stale = useDerivedStale(actorId)
    expect(stale.value).toBe(true)

    sync.markFresh('seelah')
    expect(stale.value).toBe(false)
  })

  it('clears the moment a GM starts listening', () => {
    listening(false)
    useSyncStatusStore().markAwaitingRefresh('seelah')
    const stale = useDerivedStale(actorId)
    expect(stale.value).toBe(true)

    // The LISTENER_ONLINE announce also fires a re-fetch, so this is the
    // marker going away a beat before the fresh figures arrive — the right
    // order, since a GM is now there to answer.
    listening(true)
    expect(stale.value).toBe(false)
  })

  it('is scoped to its own actor', () => {
    listening(false)
    useSyncStatusStore().markAwaitingRefresh('ezren')

    expect(useDerivedStale(actorId).value).toBe(false)
    expect(useDerivedStale(ref('ezren')).value).toBe(true)
  })

  it('is false for a sheet with no actor id yet', () => {
    listening(false)
    useSyncStatusStore().markAwaitingRefresh('seelah')

    expect(useDerivedStale(ref(undefined)).value).toBe(false)
  })

  it('tracks the actor the sheet switches to', () => {
    listening(false)
    useSyncStatusStore().markAwaitingRefresh('ezren')
    const stale = useDerivedStale(actorId)
    expect(stale.value).toBe(false)

    actorId.value = 'ezren'
    expect(stale.value).toBe(true)
  })
})
