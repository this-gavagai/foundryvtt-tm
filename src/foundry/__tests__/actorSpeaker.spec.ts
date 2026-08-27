import { describe, it, expect } from 'vitest'
import { actorSpeaker } from '@/foundry/utils/foundry'

// Every chat message this module posts is posted from the ELECTED GM's client on
// behalf of a remote player, so the speaker has to be built without consulting
// that client's canvas. ChatMessage.getSpeaker does consult it: it resolves scene
// and token from whatever scene the GM has open, which can attach the GM's own
// selected token to a player's message and is undefined when no scene is loaded.
// That canvas dependency is also what trips third-party preCreateChatMessage
// hooks that do `canvas.tokens.get(...)`.
//
// So the property that matters is negative: the speaker carries NO scene and NO
// token, only actor identity. globals.ts backs this up by not declaring
// getSpeaker on its ChatMessage accessor at all.

describe('actorSpeaker', () => {
  it('carries actor identity and nothing canvas-derived', () => {
    const speaker = actorSpeaker({ id: 'seelah-id', name: 'Seelah' })
    expect(speaker).toEqual({ actor: 'seelah-id', alias: 'Seelah' })
    expect(speaker).not.toHaveProperty('scene')
    expect(speaker).not.toHaveProperty('token')
  })

  it('survives an actor with no id or name', () => {
    expect(actorSpeaker({})).toEqual({ actor: undefined, alias: undefined })
    expect(actorSpeaker({ id: null, name: null })).toEqual({ actor: undefined, alias: undefined })
  })

  // It never reads a global, so it works with no canvas, no ui, and no game — the
  // whole point of preferring it to getSpeaker.
  it('needs no Foundry globals', () => {
    const g = globalThis as Record<string, unknown>
    const saved = { game: g.game, canvas: g.canvas, ui: g.ui }
    delete g.game
    delete g.canvas
    delete g.ui
    try {
      expect(actorSpeaker({ id: 'a', name: 'A' })).toEqual({ actor: 'a', alias: 'A' })
    } finally {
      Object.assign(g, saved)
    }
  })
})
