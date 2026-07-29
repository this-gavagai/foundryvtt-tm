import { describe, it, expect, afterEach } from 'vitest'
import { registerStoreBridge, resetStoreBridgeForTest } from '@/api/storeBridge'
import { getCompendiumItem } from '@/api/compendium'
import { fakeStoreBridge } from './socketMock'

// Chat and item descriptions link items that live on a world actor, not in a
// pack (PF2e Dailies posts `@UUID[Actor.<id>.Item.<id>]` for the staff it
// prepared). Those resolve straight from the loaded world payload — no socket —
// so the link gets a name and the item modal has something to show.
afterEach(() => resetStoreBridgeForTest())

const STAFF = {
  _id: 'sbhyq2EEmlvfEK7q',
  name: 'Staff of Fire',
  type: 'weapon',
  img: 'icons/staff.webp',
  system: { description: { value: '<p>Burns.</p>' } }
}

function bridgeWithActor() {
  registerStoreBridge(
    fakeStoreBridge({
      getWorldActor: (actorId) =>
        actorId === 'hCCJ4opKZGAYxDQi'
          ? { name: 'Doomsy', items: [{ _id: 'other', name: 'Rope' }, STAFF] }
          : undefined
    })
  )
}

describe('getCompendiumItem — actor-embedded uuids', () => {
  it('resolves an item off a world actor, crediting the actor as the source', async () => {
    bridgeWithActor()
    const { compendiumItem } = await getCompendiumItem(
      'Actor.hCCJ4opKZGAYxDQi.Item.sbhyq2EEmlvfEK7q'
    )
    expect(compendiumItem).toMatchObject({
      _id: 'sbhyq2EEmlvfEK7q',
      name: 'Staff of Fire',
      type: 'weapon',
      source: 'Doomsy'
    })
    expect(compendiumItem?.system?.description?.value).toBe('<p>Burns.</p>')
  })

  it('answers null for an unknown actor or item instead of hitting the socket', async () => {
    bridgeWithActor()
    await expect(getCompendiumItem('Actor.nope.Item.sbhyq2EEmlvfEK7q')).resolves.toEqual({
      compendiumItem: null
    })
    await expect(getCompendiumItem('Actor.hCCJ4opKZGAYxDQi.Item.nope')).resolves.toEqual({
      compendiumItem: null
    })
  })
})
