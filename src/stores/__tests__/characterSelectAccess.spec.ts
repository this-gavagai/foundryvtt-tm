// @vitest-environment jsdom
// The settings store (skipCharacterAlts) reads localStorage.
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { GamePF2e } from '@7h3laughingman/pf2e-types'

import { useWorldStore } from '@/stores/world'
import { useCharacterSelectStore } from '@/stores/characterSelect'
import { useFoundryWorldStatusStore } from '@/stores/foundryWorldStatus'

// A GM is essentially never listed in an actor's ownership map — Foundry grants
// them ownership by role instead — so reading that map literally left a GM login
// with an empty character list. These pin the role-based path.

const ACTORS = [
  { _id: 'pc-owned', type: 'character', ownership: { player: 3 } },
  { _id: 'pc-other', type: 'character', ownership: { someone: 3 } },
  { _id: 'familiar', type: 'familiar', ownership: { someone: 3 } },
  { _id: 'npc', type: 'npc', ownership: {} },
  { _id: 'npc-2', type: 'npc', ownership: {} },
  { _id: 'party', type: 'party', ownership: { player: 3 } }
]

function loadWorld(userId: string) {
  useWorldStore().world = {
    userId,
    actors: ACTORS,
    users: [
      { _id: 'player', role: 1 },
      { _id: 'gm', role: 4 },
      { _id: 'assistant', role: 3 }
    ],
    messages: []
  } as unknown as GamePF2e
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('characterList access', () => {
  it('gives a player only the actors naming them in ownership', () => {
    loadWorld('player')
    expect(useCharacterSelectStore().characterList).toEqual(['pc-owned'])
  })

  it('gives a GM every character and familiar in the world', () => {
    loadWorld('gm')
    expect(useCharacterSelectStore().characterList).toEqual(['pc-owned', 'pc-other', 'familiar'])
  })

  // Foundry's User#isGM is hasRole(ASSISTANT), and testUserPermission grants
  // ownership to anyone it's true for — so the app has to agree, or an assistant
  // sees nothing while the Foundry side happily serves them every actor.
  it('treats an assistant GM (role 3) the same as a GM', () => {
    loadWorld('assistant')
    expect(useCharacterSelectStore().characterList).toEqual(['pc-owned', 'pc-other', 'familiar'])
  })

  it('leaves npcs and the party actor out of the GM list', () => {
    loadWorld('gm')
    const list = useCharacterSelectStore().characterList
    expect(list).not.toContain('npc')
    expect(list).not.toContain('party')
  })

  it('keeps a deep-linked character a GM does not explicitly own', () => {
    loadWorld('gm')
    const select = useCharacterSelectStore()
    select.initialize('pc-other')
    expect(select.activeCharacterId).toBe('pc-other')
    expect(select.characterList).toContain('pc-other')
  })
})

// A blank screen on native, reported against a v14 server: signing in as a
// different user cleared the world but left worldAuthenticated `true`, which
// satisfies every readiness gate in ConnectedApp while characterList is empty —
// so it rendered a TabGroup with zero panels and no spinner to replace it.
describe('clearWorld', () => {
  it('empties the character list', () => {
    loadWorld('gm')
    const select = useCharacterSelectStore()
    expect(select.characterList.length).toBeGreaterThan(0)

    useWorldStore().clearWorld()
    expect(select.characterList).toEqual([])
  })

  it('returns worldAuthenticated to pending, so the empty list reads as loading', () => {
    loadWorld('gm')
    const status = useFoundryWorldStatusStore()
    status.markWorldLoaded()
    status.setWorldAuthenticated(true)

    useWorldStore().clearWorld()

    // The pair is set together by sendWorldRequest and must be cleared
    // together: `true` over an absent world is the unrenderable combination.
    expect(status.worldAuthenticated).toBeUndefined()
  })
})

// NPCs are deliberately kept out of a GM's list (GM_LISTED_TYPES) because each
// listed entry mounts a sheet that pulls a full actor payload — auto-listing a
// bestiary would be ruinous. They stay reachable one at a time through urlId,
// which is what the picker's search selects with.
describe('openActor', () => {
  it('opens an npc a GM would never see in the list', () => {
    loadWorld('gm')
    const select = useCharacterSelectStore()
    expect(select.characterList).not.toContain('npc')

    select.openActor('npc')

    expect(select.activeCharacterId).toBe('npc')
    expect(select.characterList).toContain('npc')
  })

  it('swaps one npc for another instead of accumulating them', () => {
    loadWorld('gm')
    const select = useCharacterSelectStore()

    select.openActor('npc')
    select.openActor('npc-2')

    expect(select.characterList).toContain('npc-2')
    expect(select.characterList).not.toContain('npc')
  })

  it('ignores an actor type that has no sheet to render', () => {
    loadWorld('gm')
    const select = useCharacterSelectStore()
    const before = select.activeCharacterId

    select.openActor('party')

    expect(select.activeCharacterId).toBe(before)
    expect(select.characterList).not.toContain('party')
  })

  it('does not let a player open an npc they were never given', () => {
    loadWorld('player')
    const select = useCharacterSelectStore()

    select.openActor('npc')

    expect(select.activeCharacterId).not.toBe('npc')
    expect(select.characterList).toEqual(['pc-owned'])
  })
})
