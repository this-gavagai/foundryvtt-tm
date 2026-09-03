import { describe, it, expect } from 'vitest'
import {
  parseCompendiumUuid,
  parseEmbeddedItemUuid,
  packObserveLevel,
  isPackVisible,
  listVisiblePacks,
  shapeIndexEntries,
  foldJournalDescription,
  shapeCompendiumItem,
  type PackMetadataLike
} from '@/utils/compendiumData'

describe('parseCompendiumUuid', () => {
  it('splits a compendium uuid into pack/type/id', () => {
    expect(parseCompendiumUuid('Compendium.pf2e.equipment-srd.Item.abc123')).toEqual({
      packId: 'pf2e.equipment-srd',
      documentType: 'Item',
      id: 'abc123'
    })
  })

  it('rejects non-compendium and malformed uuids', () => {
    expect(parseCompendiumUuid('Actor.xyz')).toBeUndefined()
    expect(parseCompendiumUuid('Compendium.pf2e.equipment-srd')).toBeUndefined()
  })
})

describe('parseEmbeddedItemUuid', () => {
  it('splits an actor-embedded item uuid into actor/item ids', () => {
    expect(parseEmbeddedItemUuid('Actor.hCCJ4opKZGAYxDQi.Item.sbhyq2EEmlvfEK7q')).toEqual({
      actorId: 'hCCJ4opKZGAYxDQi',
      itemId: 'sbhyq2EEmlvfEK7q'
    })
  })

  it('reads the actor/item pair off a token-scoped uuid', () => {
    expect(parseEmbeddedItemUuid('Scene.s1.Token.t1.Actor.a1.Item.i1')).toEqual({
      actorId: 'a1',
      itemId: 'i1'
    })
  })

  it('rejects compendium, bare-actor and trailing-segment uuids', () => {
    expect(parseEmbeddedItemUuid('Compendium.pf2e.feats-srd.Item.abc123')).toBeUndefined()
    expect(parseEmbeddedItemUuid('Actor.a1')).toBeUndefined()
    expect(parseEmbeddedItemUuid('Actor.a1.Item.i1.ActiveEffect.e1')).toBeUndefined()
  })
})

describe('packObserveLevel', () => {
  it('gives a GM (role 4) owner over everything', () => {
    expect(packObserveLevel({ PLAYER: 'NONE' }, 4)).toBe(3)
  })

  it('reads the level for the user role, inheriting lower roles', () => {
    expect(packObserveLevel({ PLAYER: 'OBSERVER' }, 1)).toBe(2)
    // An assistant (3) inherits the PLAYER grant when no ASSISTANT entry exists.
    expect(packObserveLevel({ PLAYER: 'OBSERVER' }, 3)).toBe(2)
    // Highest across inherited roles wins.
    expect(packObserveLevel({ PLAYER: 'LIMITED', ASSISTANT: 'OWNER' }, 3)).toBe(3)
  })

  it('treats an absent role as no access', () => {
    expect(packObserveLevel({ ASSISTANT: 'OWNER' }, 1)).toBe(0)
  })
})

describe('isPackVisible', () => {
  const meta: PackMetadataLike = { id: 'pf2e.x', type: 'Item', ownership: { PLAYER: 'LIMITED' } }

  it('hides a pack below OBSERVER for the user role', () => {
    expect(isPackVisible(meta, 1)).toBe(false) // LIMITED (1) < OBSERVER (2)
  })

  it('shows a pack at OBSERVER or above', () => {
    expect(isPackVisible({ ...meta, ownership: { PLAYER: 'OBSERVER' } }, 1)).toBe(true)
  })

  it('shows a pack with no ownership block (permissive default) but needs id + type', () => {
    expect(isPackVisible({ id: 'pf2e.x', type: 'Item' }, 1)).toBe(true)
    expect(isPackVisible({ type: 'Item' }, 1)).toBe(false)
  })
})

describe('listVisiblePacks', () => {
  it('filters + maps metadata to pack info, dropping unobservable packs', () => {
    const packs: PackMetadataLike[] = [
      {
        id: 'pf2e.a',
        label: 'A',
        type: 'Item',
        packageName: 'pf2e',
        ownership: { PLAYER: 'OBSERVER' }
      },
      {
        id: 'pf2e.b',
        label: 'B',
        type: 'Actor',
        packageName: 'pf2e',
        ownership: { PLAYER: 'LIMITED' }
      },
      { collection: 'world.c', label: 'C', documentName: 'JournalEntry' } // no ownership → visible
    ]
    expect(listVisiblePacks(packs, 1)).toEqual([
      { id: 'pf2e.a', label: 'A', documentType: 'Item', packageName: 'pf2e' },
      { id: 'world.c', label: 'C', documentType: 'JournalEntry', packageName: '' }
    ])
  })
})

describe('shapeIndexEntries', () => {
  it('builds uuid/level/rarity, drops entries with no _id, and sorts by name', () => {
    const raw = [
      { _id: '2', name: 'Bear', img: 'b.png', type: 'npc', system: { level: { value: 3 } } },
      { name: 'NoId' }, // dropped
      { _id: '1', name: 'Aardvark', system: { traits: { rarity: 'rare' } } }
    ]
    const out = shapeIndexEntries(raw, 'pf2e.bestiary', 'Actor')
    expect(out.map((e) => e.name)).toEqual(['Aardvark', 'Bear'])
    expect(out[0]).toMatchObject({
      uuid: 'Compendium.pf2e.bestiary.Actor.1',
      rarity: 'rare'
    })
    expect(out[1]).toMatchObject({ uuid: 'Compendium.pf2e.bestiary.Actor.2', level: 3 })
  })
})

describe('foldJournalDescription', () => {
  it('reads a single page text.content', () => {
    expect(foldJournalDescription({ text: { content: '<p>hi</p>' } })).toBe('<p>hi</p>')
  })

  it('joins multiple pages with heading markers', () => {
    const html = foldJournalDescription({
      pages: [
        { name: 'One', text: { content: '<p>1</p>' } },
        { name: 'Two', text: { content: '<p>2</p>' } }
      ]
    })
    expect(html).toBe('<h2>One</h2><p>1</p>\n<h2>Two</h2><p>2</p>')
  })

  it('returns undefined for a non-journal document', () => {
    expect(foldJournalDescription({ system: { description: { value: 'x' } } })).toBeUndefined()
  })
})

describe('shapeCompendiumItem', () => {
  it('carries name/img/type/source and preserves item system data', () => {
    const item = shapeCompendiumItem(
      { _id: 'i1', name: 'Sword', img: 's.png', type: 'weapon', system: { level: { value: 1 } } },
      'Equipment'
    )
    expect(item).toMatchObject({
      _id: 'i1',
      name: 'Sword',
      type: 'weapon',
      source: 'Equipment',
      system: { level: { value: 1 } }
    })
  })

  it('folds a journal document’s pages into system.description.value', () => {
    const item = shapeCompendiumItem(
      { _id: 'j1', name: 'Lore', type: undefined, text: { content: '<p>story</p>' } },
      'World Notes'
    )
    expect(item.system.description?.value).toBe('<p>story</p>')
  })
})
