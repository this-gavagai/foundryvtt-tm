// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import type { Ref } from 'vue'
import type { TablemateCharacter } from '@/types/character-types'

// The two activity panels: exploration (which the character can be marked as
// currently doing) and downtime (which they cannot).
//
// PF2e keeps the exploration marks as a flat array of item ids on the actor
// (`system.exploration`) and derives nothing from them — so what these tests
// pin is the array bookkeeping and the shape of the lists, which is the whole
// feature. The write is a full replacement, which is why the prune matters:
// nothing else ever cleans the array, and PF2e's own toggle prunes on the same
// line it toggles on. Downtime has no such array to keep, which is itself worth
// pinning: a mark there would be inventing state PF2e doesn't have.

const updateActor = vi.fn((_actor: unknown, _update: object) => Promise.resolve(null))

vi.mock('@/api/actionRpc', () => ({
  characterAction: vi.fn(),
  rollCheck: vi.fn(),
  rollDamage: vi.fn(),
  runActionable: vi.fn(),
  useAction: vi.fn()
}))
vi.mock('@/api/documents', () => ({
  updateActor: (actor: unknown, update: object) => updateActor(actor, update),
  updateActorItem: vi.fn()
}))

const { useCharacterActions } = await import('@/composables/character/characterActions')

type ItemOptions = { type?: string; traits?: string[]; actionType?: string }

// An item as it arrives over the socket. PF2e's activity content is all
// `type: 'action'` with `actionType: 'passive'` — Search and Avoid Notice for
// exploration, Craft and Earn Income for downtime — so that is the default
// here.
function item(id: string, name: string, options: ItemOptions = {}) {
  return {
    _id: id,
    name,
    type: options.type ?? 'action',
    system: {
      actionType: { value: options.actionType ?? 'passive' },
      actions: { value: null },
      traits: { value: options.traits ?? ['exploration'] }
    }
  }
}

// Cast at the fixture boundary, once, as characterActionUse.spec does:
// TablemateCharacter claims CharacterPF2e, but what the app holds is the plain
// JSON the Foundry side serialized with toObject().
function characterWith(items: unknown[], exploration?: unknown) {
  const actor = ref({
    _id: 'seelah',
    items,
    system: exploration === undefined ? {} : { exploration }
  }) as unknown as Ref<TablemateCharacter | undefined>
  return useCharacterActions(actor)
}

beforeEach(() => updateActor.mockClear())

describe('which items are offered as exploration activities', () => {
  it('lists ability items carrying the exploration trait', () => {
    const { explorationActivities } = characterWith([
      item('search', 'Search'),
      item('avoid', 'Avoid Notice')
    ])
    expect(explorationActivities.value?.map((a) => a.name)).toEqual(['Avoid Notice', 'Search'])
  })

  it('leaves out an ability with no exploration trait', () => {
    const { explorationActivities } = characterWith([
      item('demoralize', 'Demoralize', { actionType: 'action', traits: ['auditory'] })
    ])
    expect(explorationActivities.value).toEqual([])
  })

  it('leaves out a passive exploration feat, as PF2e does', () => {
    // Cat Nap and its kin modify an activity rather than being one; PF2e's
    // sheet skips passive feats entirely, so neither sheet offers them.
    const { explorationActivities } = characterWith([item('catnap', 'Cat Nap', { type: 'feat' })])
    expect(explorationActivities.value).toEqual([])
  })

  it('includes an exploration feat that carries an action cost of its own', () => {
    const { explorationActivities } = characterWith([
      item('homebrew', 'Homebrew Activity', { type: 'feat', actionType: 'action' })
    ])
    expect(explorationActivities.value?.map((a) => a.name)).toEqual(['Homebrew Activity'])
  })

  it('keeps an exploration activity out of the ordinary actions list', () => {
    // PF2e sorts on the trait before it buckets by action cost, so an activity
    // with a real action cost belongs to one panel, not both.
    const { actions, explorationActivities } = characterWith([
      item('homebrew', 'Homebrew Activity', { type: 'action', actionType: 'action' })
    ])
    expect(actions.value).toEqual([])
    expect(explorationActivities.value?.map((a) => a.name)).toEqual(['Homebrew Activity'])
  })
})

describe('reading which activities are active', () => {
  it('marks the ids stored on the actor', () => {
    const { explorationActivities } = characterWith(
      [item('search', 'Search'), item('avoid', 'Avoid Notice')],
      ['search']
    )
    const byName = Object.fromEntries(
      (explorationActivities.value ?? []).map((a) => [a.name, a.active])
    )
    expect(byName).toEqual({ Search: true, 'Avoid Notice': false })
  })

  it('sorts the active ones to the top, then by name', () => {
    const { explorationActivities } = characterWith(
      [item('avoid', 'Avoid Notice'), item('scout', 'Scout'), item('search', 'Search')],
      ['search']
    )
    expect(explorationActivities.value?.map((a) => a.name)).toEqual([
      'Search',
      'Avoid Notice',
      'Scout'
    ])
  })

  it('treats a payload with no exploration key as nothing active', () => {
    // An older Foundry-side build sends no such key at all.
    const { explorationActivities } = characterWith([item('search', 'Search')])
    expect(explorationActivities.value?.[0].active).toBe(false)
  })
})

describe('toggling an activity', () => {
  it('adds its id to the stored list', async () => {
    const { explorationActivities } = characterWith(
      [item('search', 'Search'), item('avoid', 'Avoid Notice')],
      ['avoid']
    )
    await explorationActivities.value?.find((a) => a.name === 'Search')?.toggleActive()
    expect(updateActor).toHaveBeenCalledTimes(1)
    expect(updateActor.mock.calls[0][1]).toEqual({ system: { exploration: ['avoid', 'search'] } })
  })

  it('removes its id when it was already active', async () => {
    const { explorationActivities } = characterWith(
      [item('search', 'Search'), item('avoid', 'Avoid Notice')],
      ['avoid', 'search']
    )
    await explorationActivities.value?.find((a) => a.name === 'Search')?.toggleActive()
    expect(updateActor.mock.calls[0][1]).toEqual({ system: { exploration: ['avoid'] } })
  })

  it('writes an empty list when the last one is switched off', async () => {
    const { explorationActivities } = characterWith([item('search', 'Search')], ['search'])
    await explorationActivities.value?.[0].toggleActive()
    expect(updateActor.mock.calls[0][1]).toEqual({ system: { exploration: [] } })
  })

  it('prunes ids whose item the actor no longer has', async () => {
    // Deleting an activity while it was active leaves its id behind: nothing
    // in PF2e cleans the array, so every write has to.
    const { explorationActivities } = characterWith(
      [item('search', 'Search')],
      ['deleted-activity']
    )
    await explorationActivities.value?.[0].toggleActive()
    expect(updateActor.mock.calls[0][1]).toEqual({ system: { exploration: ['search'] } })
  })
})

describe('downtime activities', () => {
  it('lists the downtime-trait abilities, by name', () => {
    const { downtimeActivities } = characterWith([
      item('income', 'Earn Income', { traits: ['downtime'] }),
      item('craft', 'Craft', { traits: ['downtime'] })
    ])
    expect(downtimeActivities.value?.map((a) => a.name)).toEqual(['Craft', 'Earn Income'])
  })

  it('keeps the two activity panels apart', () => {
    const { explorationActivities, downtimeActivities } = characterWith([
      item('search', 'Search'),
      item('craft', 'Craft', { traits: ['downtime'] })
    ])
    expect(explorationActivities.value?.map((a) => a.name)).toEqual(['Search'])
    expect(downtimeActivities.value?.map((a) => a.name)).toEqual(['Craft'])
  })

  it('files an ability carrying both traits under exploration, as PF2e does', () => {
    // PF2e tests exploration first and stops — an else-if chain, not two
    // independent buckets — so an item like this appears once, not twice.
    const { explorationActivities, downtimeActivities } = characterWith([
      item('both', 'Both Modes', { traits: ['downtime', 'exploration'] })
    ])
    expect(explorationActivities.value?.map((a) => a.name)).toEqual(['Both Modes'])
    expect(downtimeActivities.value).toEqual([])
  })

  it('leaves out a passive downtime feat, as PF2e does', () => {
    const { downtimeActivities } = characterWith([
      item('train', 'Train Animal', { type: 'feat', traits: ['downtime'] })
    ])
    expect(downtimeActivities.value).toEqual([])
  })

  it('keeps a downtime activity out of the ordinary actions list', () => {
    const { actions, downtimeActivities } = characterWith([
      item('homebrew', 'Homebrew Downtime', {
        traits: ['downtime'],
        actionType: 'action'
      })
    ])
    expect(actions.value).toEqual([])
    expect(downtimeActivities.value?.map((a) => a.name)).toEqual(['Homebrew Downtime'])
  })

  it('offers no active mark, because PF2e stores none', () => {
    const { downtimeActivities } = characterWith([item('craft', 'Craft', { traits: ['downtime'] })])
    expect(downtimeActivities.value?.[0]).not.toHaveProperty('active')
    expect(downtimeActivities.value?.[0]).not.toHaveProperty('toggleActive')
  })
})
