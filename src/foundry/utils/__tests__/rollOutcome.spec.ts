import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GamePF2e } from '@7h3laughingman/pf2e-types'

// The module runs on the elected GM's client, which can read every DC and every
// hidden name in the world, and it answers a tablet that usually belongs to a
// player. PF2e's own answer to that — render the whole card and hide parts of it
// from non-GMs — is not available once the payload has left the GM's machine, so
// these pin the withholding at the wire instead: what is not this user's to see
// must never be in the object at all.

vi.mock('@/utils/utilities', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() }
}))

// PF2e's DC-name dictionary, at the shape describeRollOutcome reads it, plus a
// localizer that resolves the handful of keys these cases use and echoes the
// rest — which is Foundry's own behaviour for an untranslated key.
const TRANSLATIONS: Record<string, string> = {
  'PF2E.Check.DC.Specific.armor': 'AC',
  'PF2E.Check.DC.Specific.reflex': 'Reflex DC',
  'PF2E.Check.DC.Unspecific': 'DC'
}

let settings: Record<string, boolean>
let documents: Record<string, unknown>

vi.mock('@/foundry/globals', () => ({
  localize: (key: string) => TRANSLATIONS[key] ?? key,
  configPF2E: () => ({
    checkDCs: {
      Specific: {
        armor: 'PF2E.Check.DC.Specific.armor',
        reflex: 'PF2E.Check.DC.Specific.reflex'
      },
      Unspecific: 'PF2E.Check.DC.Unspecific'
    }
  }),
  resolveUuidSync: (uuid: string) => documents[uuid] ?? null,
  settingsApi: () => ({ get: (_scope: string, key: string) => settings[key] })
}))

let asker: { isGM?: boolean } | undefined
vi.mock('@/foundry/utils/permissions', () => ({
  getRequestingUser: () => asker
}))

import { describeRollOutcome, outcomeMessageOf } from '@/foundry/utils/rollOutcome'

const source = {} as GamePF2e

const GOBLIN_TOKEN = 'Scene.abc.Token.goblin'
const GOBLIN_ACTOR = 'Actor.goblin'

function goblin(
  overrides: { playersCanSeeName?: boolean; hasPlayerOwner?: boolean; ring?: object } = {}
) {
  return {
    [GOBLIN_TOKEN]: {
      name: 'Goblin Warrior',
      texture: { src: 'tokens/goblin.webp' },
      ring: overrides.ring,
      playersCanSeeName: overrides.playersCanSeeName ?? true,
      actor: {
        name: 'Goblin',
        img: 'actors/goblin.webp',
        hasPlayerOwner: !!overrides.hasPlayerOwner
      }
    }
  }
}

// A strike's card: targeted, rolled against the target's AC, and won.
function attackMessage(context: object = {}) {
  return {
    flags: {
      pf2e: {
        context: {
          type: 'attack-roll',
          target: { actor: GOBLIN_ACTOR, token: GOBLIN_TOKEN },
          dc: { slug: 'armor', scope: 'attack' as const, value: 18, visible: false },
          outcome: 'criticalSuccess',
          unadjustedOutcome: 'criticalSuccess',
          ...context
        }
      }
    }
  }
}

beforeEach(() => {
  // The permissive-but-realistic default: results are public (PF2e's own
  // default), DCs are not, and token names are whatever the token says.
  settings = {
    metagame_showResults: true,
    metagame_showDC: false,
    metagame_tokenSetsNameVisibility: true
  }
  documents = goblin()
  asker = { isGM: false }
})

describe('describeRollOutcome', () => {
  it('names the target and the degree of success of an attack', () => {
    expect(describeRollOutcome(source, attackMessage(), 'player-1')).toEqual({
      targetName: 'Goblin Warrior',
      targetImg: 'tokens/goblin.webp',
      degree: 'criticalSuccess',
      scope: 'attack'
    })
  })

  it('withholds a DC the world hides, without withholding the result', () => {
    const outcome = describeRollOutcome(source, attackMessage(), 'player-1')

    // The margin the app draws is computed from the DC, so a DC that never
    // arrives is a margin that cannot be shown either.
    expect(outcome?.dc).toBeUndefined()
    expect(outcome?.dcLabel).toBeUndefined()
    expect(outcome?.degree).toBe('criticalSuccess')
  })

  it('reports a DC the world shows, with PF2e own name for it', () => {
    settings.metagame_showDC = true

    expect(describeRollOutcome(source, attackMessage(), 'player-1')).toMatchObject({
      dc: 18,
      dcLabel: 'AC'
    })
  })

  it('reports a DC the roll itself made public', () => {
    const message = attackMessage({ dc: { slug: 'reflex', value: 20, visible: true } })

    expect(describeRollOutcome(source, message, 'player-1')).toMatchObject({
      dc: 20,
      dcLabel: 'Reflex DC'
    })
  })

  it('reports the DC of a creature the players own', () => {
    documents = goblin({ hasPlayerOwner: true })

    expect(describeRollOutcome(source, attackMessage(), 'player-1')).toMatchObject({ dc: 18 })
  })

  it('falls back to the unspecific DC name for a check with no defense slug', () => {
    const message = attackMessage({ dc: { value: 15, visible: true }, target: null })

    expect(describeRollOutcome(source, message, 'player-1')).toMatchObject({
      dc: 15,
      dcLabel: 'DC'
    })
  })

  it('withholds the degree when the world hides results', () => {
    settings.metagame_showResults = false

    const outcome = describeRollOutcome(source, attackMessage(), 'player-1')

    expect(outcome?.degree).toBeUndefined()
    expect(outcome?.targetName).toBe('Goblin Warrior')
  })

  it('withholds a token name the players cannot see, keeping its art', () => {
    documents = goblin({ playersCanSeeName: false })

    const outcome = describeRollOutcome(source, attackMessage(), 'player-1')

    expect(outcome?.targetName).toBeUndefined()
    expect(outcome?.targetImg).toBe('tokens/goblin.webp')
  })

  it('names a hidden token when the world does not play with name visibility', () => {
    documents = goblin({ playersCanSeeName: false })
    settings.metagame_tokenSetsNameVisibility = false

    expect(describeRollOutcome(source, attackMessage(), 'player-1')?.targetName).toBe(
      'Goblin Warrior'
    )
  })

  it('tells a GM asker everything the world hides from players', () => {
    asker = { isGM: true }
    settings = {
      metagame_showResults: false,
      metagame_showDC: false,
      metagame_tokenSetsNameVisibility: true
    }
    documents = goblin({ playersCanSeeName: false })

    expect(describeRollOutcome(source, attackMessage(), 'gm-1')).toEqual({
      targetName: 'Goblin Warrior',
      targetImg: 'tokens/goblin.webp',
      dc: 18,
      dcLabel: 'AC',
      degree: 'criticalSuccess',
      scope: 'attack'
    })
  })

  it('reports the pre-adjustment degree only when an adjustment moved it', () => {
    const adjusted = attackMessage({ outcome: 'success', unadjustedOutcome: 'failure' })
    expect(describeRollOutcome(source, adjusted, 'player-1')?.unadjustedDegree).toBe('failure')

    expect(
      describeRollOutcome(source, attackMessage(), 'player-1')?.unadjustedDegree
    ).toBeUndefined()
  })

  it('names the target of a damage roll without calling it a success', () => {
    // PF2e stamps `outcome: "success"` on the damage roll following an attack,
    // where it separates normal damage from critical rather than naming a
    // degree of success. There is no DC on that card, which is what tells the
    // two apart.
    const message = attackMessage({ type: 'damage-roll', dc: null, outcome: 'success' })

    expect(describeRollOutcome(source, message, 'player-1')).toEqual({
      targetName: 'Goblin Warrior',
      targetImg: 'tokens/goblin.webp'
    })
  })

  it('sends the art a ringed token actually draws, not its full-frame portrait', () => {
    documents = goblin({ ring: { enabled: true, subject: { texture: 'tokens/goblin-ring.webp' } } })

    expect(describeRollOutcome(source, attackMessage(), 'player-1')?.targetImg).toBe(
      'tokens/goblin-ring.webp'
    )
  })

  it('describes a target with no placed token from the actor prototype', () => {
    // PF2e answers the same question the same way when the token document is
    // out of reach: the prototype says whether players may see the name, and
    // carries the art the placeable would have drawn.
    documents = {
      [GOBLIN_ACTOR]: {
        name: 'Goblin',
        img: 'actors/goblin.webp',
        prototypeToken: { playersCanSeeName: true, texture: { src: 'tokens/proto.webp' } }
      }
    }

    expect(describeRollOutcome(source, attackMessage(), 'player-1')).toMatchObject({
      targetName: 'Goblin',
      targetImg: 'tokens/proto.webp'
    })
  })

  it('withholds the name of a targeted actor nothing says players may see', () => {
    documents = { [GOBLIN_ACTOR]: { name: 'Goblin', img: 'actors/goblin.webp' } }

    const outcome = describeRollOutcome(source, attackMessage(), 'player-1')

    expect(outcome?.targetName).toBeUndefined()
    expect(outcome?.targetImg).toBe('actors/goblin.webp')
  })

  it('reports nothing for a roll with no target, DC or result', () => {
    // An untargeted skill check against no DC: PF2e still writes a context, and
    // there is simply nothing in it the modal can show.
    const message = { flags: { pf2e: { context: {} } } }

    expect(describeRollOutcome(source, message, 'player-1')).toBeUndefined()
  })

  it('reports nothing for a card that is not a PF2e roll, or no card at all', () => {
    expect(describeRollOutcome(source, { flags: {} }, 'player-1')).toBeUndefined()
    expect(describeRollOutcome(source, undefined, 'player-1')).toBeUndefined()
  })

  it('drops a degree it has no wording for rather than forwarding it', () => {
    const message = attackMessage({ outcome: 'spectacularSuccess' })

    expect(describeRollOutcome(source, message, 'player-1')?.degree).toBeUndefined()
  })

  it('answers nothing rather than failing the ack when a lookup throws', () => {
    documents = {
      get [GOBLIN_TOKEN]() {
        throw new Error('no such scene')
      }
    }

    expect(describeRollOutcome(source, attackMessage(), 'player-1')).toBeUndefined()
  })
})

describe('outcomeMessageOf', () => {
  it('finds the card in what a PF2e action pipeline hands back', () => {
    const message = attackMessage()

    expect(outcomeMessageOf([{ message }])).toBe(message)
  })

  it('answers nothing for a result that rolled no card', () => {
    expect(outcomeMessageOf([{}])).toBeUndefined()
    expect(outcomeMessageOf([])).toBeUndefined()
    expect(outcomeMessageOf(undefined)).toBeUndefined()
  })
})
