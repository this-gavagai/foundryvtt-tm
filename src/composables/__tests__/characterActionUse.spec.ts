// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import type { Ref } from 'vue'
import type { TablemateCharacter } from '@/types/character-types'

// Which actions get a Use button, and where one tap goes.
//
// PF2e's sheets draw the button off createAbilityViewData's `usable`
// (selfEffect || frequency || crafting); the app carries the frequency arm
// (see defs/action) and adds the toolbelt one. The routing matters more than
// it looks: a toolbelt actionable macro REPLACES an action's default behavior
// — toolbelt hands the macro a `use()` callback to opt back into it — so
// firing PF2e's native use path alongside a macro would spend the frequency
// twice and post two cards.
//
// `setUses` is the other half — the manual correction PF2e offers as a number
// input beside its Use button. It must stay a plain field write: routing it
// through the use path would post a card every time a player fixed a mis-tap.

const runActionable = vi.fn((_actor: unknown, _itemId: string) => Promise.resolve(null))
const useAction = vi.fn((_actor: unknown, _itemId: string) => Promise.resolve(null))
const updateActorItem = vi.fn((_actor: unknown, _itemId: string, _update: object) =>
  Promise.resolve(null)
)

vi.mock('@/api/actionRpc', () => ({
  characterAction: vi.fn(),
  rollCheck: vi.fn(),
  rollDamage: vi.fn(),
  runActionable: (actor: unknown, itemId: string) => runActionable(actor, itemId),
  useAction: (actor: unknown, itemId: string) => useAction(actor, itemId)
}))
vi.mock('@/api/documents', () => ({
  updateActor: vi.fn(() => Promise.resolve(null)),
  updateActorItem: (actor: unknown, itemId: string, update: object) =>
    updateActorItem(actor, itemId, update)
}))

const { useCharacterActions } = await import('@/composables/character/characterActions')

type ItemOptions = {
  frequency?: { max: number; per: string }
  macroUuid?: string
}

// An ability item as it arrives over the socket, trimmed to what the model
// reads. `system.frequency` is what getCharacterDetails overlays onto source.
function ability(id: string, name: string, options: ItemOptions = {}) {
  return {
    _id: id,
    name,
    type: 'action',
    system: {
      actionType: { value: 'action' },
      actions: { value: 1 },
      traits: { value: [] },
      ...(options.frequency ? { frequency: { ...options.frequency, value: 1 } } : {})
    },
    ...(options.macroUuid
      ? { flags: { 'pf2e-toolbelt': { actionable: { linked: options.macroUuid } } } }
      : {})
  }
}

// Cast at the fixture boundary, once, the way characterStrikes.spec does:
// TablemateCharacter claims CharacterPF2e, but what the app holds — here and in
// production — is the plain JSON the Foundry side serialized with toObject().
function actionsFor(items: unknown[]) {
  const actor = ref({ _id: 'seelah', items }) as unknown as Ref<TablemateCharacter | undefined>
  return useCharacterActions(actor).actions.value ?? []
}

beforeEach(() => {
  runActionable.mockClear()
  useAction.mockClear()
  updateActorItem.mockClear()
})

describe('a character action’s usability', () => {
  it('is usable when it has a Frequency to spend', () => {
    const [rage] = actionsFor([ability('rage', 'Rage', { frequency: { max: 1, per: 'day' } })])
    expect(rage.usable).toBe(true)
  })

  it('is not usable when it is an ordinary unlimited action', () => {
    const [demoralize] = actionsFor([ability('demoralize', 'Demoralize')])
    expect(demoralize.usable).toBe(false)
  })

  it('is usable when a toolbelt macro is attached, Frequency or not', () => {
    const [custom] = actionsFor([ability('custom', 'Custom', { macroUuid: 'Macro.abc' })])
    expect(custom.usable).toBe(true)
  })
})

describe('using a character action', () => {
  it('spends it through PF2e’s own use path', async () => {
    const [rage] = actionsFor([ability('rage', 'Rage', { frequency: { max: 1, per: 'day' } })])
    await rage.doUse?.()
    expect(useAction).toHaveBeenCalledTimes(1)
    expect(useAction.mock.calls[0][1]).toBe('rage')
    expect(runActionable).not.toHaveBeenCalled()
  })

  it('lets an attached toolbelt macro replace that path rather than joining it', async () => {
    const [rage] = actionsFor([
      ability('rage', 'Rage', { frequency: { max: 1, per: 'day' }, macroUuid: 'Macro.abc' })
    ])
    await rage.doUse?.()
    expect(runActionable).toHaveBeenCalledTimes(1)
    expect(useAction).not.toHaveBeenCalled()
  })
})

describe('correcting a character action’s remaining uses', () => {
  it('writes the frequency field directly, posting nothing', async () => {
    const [rage] = actionsFor([ability('rage', 'Rage', { frequency: { max: 3, per: 'day' } })])
    await rage.setUses?.(2)
    expect(updateActorItem).toHaveBeenCalledTimes(1)
    const [, itemId, update] = updateActorItem.mock.calls[0]
    expect(itemId).toBe('rage')
    expect(update).toEqual({ system: { frequency: { value: 2 } } })
    expect(useAction).not.toHaveBeenCalled()
    expect(runActionable).not.toHaveBeenCalled()
  })

  it('is absent on an action with no Frequency to correct', () => {
    const [demoralize] = actionsFor([ability('demoralize', 'Demoralize')])
    expect(demoralize.setUses).toBeUndefined()
  })

  it('is offered even where a toolbelt macro owns the use', () => {
    const [custom] = actionsFor([
      ability('custom', 'Custom', { frequency: { max: 1, per: 'day' }, macroUuid: 'Macro.abc' })
    ])
    expect(custom.setUses).toBeTypeOf('function')
  })
})
