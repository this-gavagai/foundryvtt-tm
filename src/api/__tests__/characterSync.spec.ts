import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'

// parseActorData is the merge point for every UPDATE_CHARACTER payload: it
// gates on actor id + dirty flag + last-request uuid, then does a positional
// merge for scalars and an ID-based merge for items (update matching, remove
// missing, append new). These tests pin the gates and the item-merge rules,
// which no integration path exercises.

const { emit } = vi.hoisted(() => ({ emit: vi.fn() }))

vi.mock('@/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/internal')>()
  return {
    ...actual,
    getAuthenticatedSocket: vi.fn(async () => ({ socket: { emit }, userId: 'user-1' }))
  }
})
vi.mock('@/utils/actorCache', () => ({ saveActorSnapshot: vi.fn() }))
vi.mock('@/stores/serverAddress', () => ({
  useServerAddressStore: () => ({ serverUrl: new URL('https://vtt.example.com') })
}))

import { parseActorData, sendCharacterRequest, setCharUnsynced } from '@/api/characterSync'
import { TM } from '@/api/protocol'
import type { UpdateCharacterDetailsArgs } from '@/types/api-types'
import type { TablemateActor } from '@/types/character-types'
import { lastEmittedUuid } from './socketMock'

// Register a request so parseActorData's last-request-uuid gate matches, and
// return that uuid (captured off the emitted REQUEST_CHARACTER payload).
async function requestUuidFor(actorId: string): Promise<string> {
  await sendCharacterRequest(actorId)
  return lastEmittedUuid(emit)
}

function makePayload(
  actorId: string,
  uuid: string,
  overrides: Partial<UpdateCharacterDetailsArgs> = {}
): UpdateCharacterDetailsArgs {
  return {
    action: TM.UPDATE_CHARACTER,
    actorId,
    userId: 'gm-1',
    uuid,
    actor: { name: 'Amiri' } as UpdateCharacterDetailsArgs['actor'],
    system: {
      attributes: { hp: { value: 17 } }
    } as unknown as UpdateCharacterDetailsArgs['system'],
    languages: ['common'],
    proficiencyLabels: {},
    inventory: [] as unknown as UpdateCharacterDetailsArgs['inventory'],
    activeRules: [],
    elementalBlasts: null,
    spellcastingModifiers: {},
    rollOptionLabels: {},
    traitLabels: {},
    iwrLabels: {},
    skillActions: [],
    ...overrides
  }
}

type ItemShape = { _id: string; system?: Record<string, unknown> }
const withItems = (items: ItemShape[]) =>
  ({ name: 'Amiri', items }) as unknown as UpdateCharacterDetailsArgs['actor']

beforeEach(() => {
  emit.mockClear()
})

describe('parseActorData gates', () => {
  it('merges a payload answering the last request for that actor', async () => {
    const actor = ref<TablemateActor | undefined>()
    const uuid = await requestUuidFor('actor-1')

    parseActorData('actor-1', actor, makePayload('actor-1', uuid))

    expect(actor.value?.name).toBe('Amiri')
    expect(actor.value?.languages).toEqual(['common'])
    expect(
      (actor.value?.system as unknown as { attributes: { hp: { value: number } } }).attributes.hp
        .value
    ).toBe(17)
  })

  it('drops a payload whose uuid does not match the last request', async () => {
    const actor = ref<TablemateActor | undefined>()
    await requestUuidFor('actor-1')

    parseActorData('actor-1', actor, makePayload('actor-1', 'stale-request-uuid'))
    expect(actor.value).toBeUndefined()
  })

  it('drops a payload for a different actor', async () => {
    const actor = ref<TablemateActor | undefined>()
    const uuid = await requestUuidFor('actor-1')

    parseActorData('actor-1', actor, makePayload('actor-2', uuid))
    expect(actor.value).toBeUndefined()
  })

  it('drops a payload once the actor is flagged dirty', async () => {
    const actor = ref<TablemateActor | undefined>()
    const uuid = await requestUuidFor('actor-1')
    setCharUnsynced('actor-1', true)

    parseActorData('actor-1', actor, makePayload('actor-1', uuid))
    expect(actor.value).toBeUndefined()

    // sendCharacterRequest clears the flag: the follow-up merge lands.
    const retryUuid = await requestUuidFor('actor-1')
    parseActorData('actor-1', actor, makePayload('actor-1', retryUuid))
    expect(actor.value?.name).toBe('Amiri')
  })
})

describe('parseActorData item merge', () => {
  it('updates matching items by id, removes missing ones, appends new ones', async () => {
    const actor = ref<TablemateActor | undefined>()
    const first = await requestUuidFor('actor-1')
    parseActorData(
      'actor-1',
      actor,
      makePayload('actor-1', first, {
        actor: withItems([
          { _id: 'sword', system: { quantity: 1, slug: 'sword' } },
          { _id: 'shield', system: { slug: 'shield' } }
        ])
      })
    )

    const second = await requestUuidFor('actor-1')
    parseActorData(
      'actor-1',
      actor,
      makePayload('actor-1', second, {
        actor: withItems([
          { _id: 'sword', system: { quantity: 3 } },
          { _id: 'potion', system: { slug: 'potion' } }
        ])
      })
    )

    const items = actor.value?.items as unknown as ItemShape[]
    expect(items.map((i) => i._id)).toEqual(['sword', 'potion'])
    // Deep merge on the matching item: quantity updated, untouched keys kept.
    expect(items[0].system).toMatchObject({ quantity: 3, slug: 'sword' })
  })
})
