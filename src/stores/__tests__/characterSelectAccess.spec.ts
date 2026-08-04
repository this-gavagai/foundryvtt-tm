// @vitest-environment jsdom
// The settings store (skipCharacterAlts) reads localStorage.
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { GamePF2e } from '@7h3laughingman/pf2e-types'

import { useWorldStore } from '@/stores/world'
import { useCharacterSelectStore } from '@/stores/characterSelect'

// A GM is essentially never listed in an actor's ownership map — Foundry grants
// them ownership by role instead — so reading that map literally left a GM login
// with an empty character list. These pin the role-based path.

const ACTORS = [
  { _id: 'pc-owned', type: 'character', ownership: { player: 3 } },
  { _id: 'pc-other', type: 'character', ownership: { someone: 3 } },
  { _id: 'familiar', type: 'familiar', ownership: { someone: 3 } },
  { _id: 'npc', type: 'npc', ownership: {} },
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
