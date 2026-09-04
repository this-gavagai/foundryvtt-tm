// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, type Ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { TablemateCharacter } from '@/types/character-types'

// A strike has to be resolved back to the weapon it came from before anything
// can be toggled on it. PF2e builds one strike per weapon and hands the weapon
// back as the strike's `item`, so that id is the exact link — while a strike's
// slug is `weapon.slug ?? sluggify(weapon.name)` and nothing dedupes the list,
// which makes it ambiguous the moment a character carries two of the same thing.
// Verified against the running system, pf2e 8.4.1.

type WeaponRpc = (...args: unknown[]) => Promise<null>
const setWeaponDamageType = vi.fn<WeaponRpc>(() => Promise.resolve(null))
const setWeaponLoaded = vi.fn<WeaponRpc>(() => Promise.resolve(null))
const updateActorItem = vi.fn<(...args: unknown[]) => Promise<null>>(() => Promise.resolve(null))
const recoverFailedWrite = vi.fn()

vi.mock('@/api/actionRpc', () => ({
  rollCheck: vi.fn(() => Promise.resolve(null)),
  getStrikeDamage: vi.fn(() => Promise.resolve(null)),
  toggleKineticAura: vi.fn(() => Promise.resolve(null)),
  setWeaponDamageType: (...args: unknown[]) => setWeaponDamageType(...args),
  setWeaponLoaded: (...args: unknown[]) => setWeaponLoaded(...args)
}))
vi.mock('@/api/documents', () => ({
  recoverFailedWrite: (...args: unknown[]) => recoverFailedWrite(...args),
  updateActorItem: (...args: unknown[]) => updateActorItem(...args)
}))

const { useCharacterStrikes } = await import('@/composables/character/characterStrikes')
const { useListenersStore } = await import('@/stores/listenersOnline')

// Two of the same weapon: identical slug, identical traits, different ids —
// exactly what carrying a pair of shortswords looks like on an actor.
function shortsword(id: string) {
  return {
    _id: id,
    type: 'weapon',
    name: 'Shortsword',
    system: {
      slug: 'shortsword',
      traits: { value: ['versatile-s'], toggles: { versatile: { selected: null } } },
      damage: { damageType: 'piercing' },
      runes: {}
    }
  }
}

// PF2e's strike carries the weapon it was built from, and both strikes of a
// matched pair carry the same slug.
function strikeFor(weaponId: string) {
  return {
    label: 'Shortsword',
    slug: 'shortsword',
    item: { _id: weaponId },
    variants: [],
    altUsages: [],
    traits: [],
    weaponTraits: [],
    ammunition: undefined,
    _modifiers: []
  }
}

// Cast at the fixture boundary, once. TablemateCharacter claims CharacterPF2e,
// but what the app actually holds — here and in production — is the plain JSON
// the Foundry side serialized with toObject(); the class methods the type
// promises do not exist at runtime. See composables/character/helpers.ts.
function actorRef(actor: object): Ref<TablemateCharacter | undefined> {
  return ref(actor) as unknown as Ref<TablemateCharacter | undefined>
}

function actorWithTwoShortswords(): Ref<TablemateCharacter | undefined> {
  return actorRef({
    _id: 'seelah',
    items: [shortsword('weapon-1'), shortsword('weapon-2')],
    system: { actions: [strikeFor('weapon-1'), strikeFor('weapon-2')] }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
})

describe('resolving a strike back to its weapon', () => {
  it('keeps two of the same weapon apart', () => {
    const { strikes } = useCharacterStrikes(actorWithTwoShortswords())
    expect(strikes.value?.map((s) => s.item?._id)).toEqual(['weapon-1', 'weapon-2'])
  })

  // The failure this guards: both strikes resolved to the first weapon, so
  // flipping versatile damage on the second one silently flipped the first.
  it('toggles damage type on the weapon the strike actually came from', async () => {
    const { strikes } = useCharacterStrikes(actorWithTwoShortswords())

    await strikes.value?.[1]?.setDamageType?.('slashing')

    expect(setWeaponDamageType).toHaveBeenCalledTimes(1)
    expect(setWeaponDamageType.mock.calls[0][1]).toBe('weapon-2')
  })

  it('reloads the weapon the strike actually came from', async () => {
    const { strikes } = useCharacterStrikes(actorWithTwoShortswords())

    await strikes.value?.[1]?.setLoaded?.(false)

    expect(setWeaponLoaded).toHaveBeenCalledTimes(1)
    expect(setWeaponLoaded.mock.calls[0][1]).toBe('weapon-2')
  })

  // Slug is still the fallback, for a strike whose item id names nothing on the
  // actor — the only case it was ever needed for.
  it('falls back to the slug when the strike names no matching item', () => {
    const actor = actorRef({
      _id: 'seelah',
      items: [shortsword('weapon-1')],
      system: { actions: [{ ...strikeFor('nonexistent') }] }
    })

    const { strikes } = useCharacterStrikes(actor)
    expect(strikes.value?.[0]?.item?._id).toBe('weapon-1')
  })
})

// ── Changing ammo, the one operation that spans both write lanes ────────────
//
// Picking ammo is a scalar on the weapon (direct, GM-free). Emptying a loaded
// weapon is PF2e's subitem surgery (an RPC, GM-only). When both are needed they
// are not independent: a selection that lands while the unload does not leaves a
// weapon reading "loaded with bolts" that fires arrows.

const bow = {
  _id: 'bow-1',
  type: 'weapon',
  name: 'Shortbow',
  system: { slug: 'shortbow', traits: { value: [], toggles: {} }, damage: {}, runes: {} }
}

function bowStrike(loaded: boolean) {
  return {
    label: 'Shortbow',
    slug: 'shortbow',
    item: { _id: 'bow-1' },
    variants: [],
    altUsages: [],
    traits: [],
    weaponTraits: [],
    ammunition: {
      requiresReload: true,
      loaded: loaded ? [{ quantity: 1 }] : [],
      compatible: [
        { id: 'arrows', name: 'Arrows' },
        { id: 'bolts', name: 'Bolts' }
      ]
    },
    selectedAmmoId: 'arrows',
    _modifiers: []
  }
}

function archer(loaded: boolean): Ref<TablemateCharacter | undefined> {
  return actorRef({
    _id: 'seelah',
    items: [{ ...bow, system: { ...bow.system, selectedAmmoId: 'arrows' } }],
    system: { actions: [bowStrike(loaded)] }
  })
}

/** Put a GM on the wire, so the RPC half is available. */
function gmListening() {
  useListenersStore().addListener('gm-client')
}

describe('changeAmmo with the weapon empty', () => {
  it('writes the selection and asks no GM for anything', async () => {
    const { strikes } = useCharacterStrikes(archer(false))

    await strikes.value?.[0]?.changeAmmo?.('bolts')

    expect(updateActorItem).toHaveBeenCalledTimes(1)
    expect(updateActorItem.mock.calls[0][2]).toEqual({ system: { selectedAmmoId: 'bolts' } })
    expect(setWeaponLoaded).not.toHaveBeenCalled()
  })
})

describe('changeAmmo with the weapon loaded and a GM listening', () => {
  beforeEach(gmListening)

  it('empties the weapon BEFORE recording what it should take next', async () => {
    const { strikes } = useCharacterStrikes(archer(true))

    await strikes.value?.[0]?.changeAmmo?.('bolts')

    expect(setWeaponLoaded).toHaveBeenCalledTimes(1)
    expect(setWeaponLoaded.mock.calls[0][2]).toBe(false)
    expect(updateActorItem).toHaveBeenCalledTimes(1)
    // Ordering is the whole point: the refusable write goes first.
    expect(setWeaponLoaded.mock.invocationCallOrder[0]).toBeLessThan(
      updateActorItem.mock.invocationCallOrder[0]
    )
  })

  // The reported failure. Fired together, the direct write landed on the server
  // while the RPC sat out its 30s ack timeout, and the weapon was left holding a
  // round of ammo the sheet no longer named.
  it('writes no selection at all when the unload is refused', async () => {
    setWeaponLoaded.mockRejectedValueOnce(new Error('no GM answered'))
    recoverFailedWrite.mockImplementationOnce((_actor, error) => {
      throw error
    })
    const { strikes } = useCharacterStrikes(archer(true))

    await expect(strikes.value?.[0]?.changeAmmo?.('bolts')).rejects.toThrow('no GM answered')
    expect(updateActorItem).not.toHaveBeenCalled()
  })
})

describe('changeAmmo with the weapon loaded and no GM', () => {
  it('records the choice for the next reload instead of refusing the edit', async () => {
    const { strikes } = useCharacterStrikes(archer(true))

    await strikes.value?.[0]?.changeAmmo?.('bolts')

    expect(setWeaponLoaded).not.toHaveBeenCalled()
    expect(updateActorItem).toHaveBeenCalledTimes(1)
    expect(updateActorItem.mock.calls[0][2]).toEqual({ system: { selectedAmmoId: 'bolts' } })
  })

  // Claiming the weapon is empty when the server still says otherwise is the
  // divergence the whole fix is about — so the degraded path leaves the flag
  // alone, and the strike list keeps reading it off the actor.
  it('leaves the weapon reading as loaded, because it still is', async () => {
    const actor = archer(true)
    const { strikes } = useCharacterStrikes(actor)

    await strikes.value?.[0]?.changeAmmo?.('bolts')

    expect(strikes.value?.[0]?.loaded).toBe(true)
  })
})

// A Strike rule element names the item CARRYING the rule, not a weapon:
// `_id: this.fist ? 'xxxxxxFISTxxxxxx' : this.item.id`. So a feat that both
// declares a Strike and grants a weapon leaves `action.item._id` pointing at the
// feat while the real weapon sits in its itemGrants — which the resolver chases,
// and which the ammo write must follow rather than writing a stray
// `selectedAmmoId` onto the feat. (Unreachable in pf2e 8.4.1: none of its 459
// Strike rules declares reload or ammunition. Pinned so it stays that way.)
describe('a strike whose item id names the granting feat', () => {
  function grantedBow(): Ref<TablemateCharacter | undefined> {
    return actorRef({
      _id: 'seelah',
      items: [
        { _id: 'feat-1', type: 'feat', name: 'Bow Feat', system: { slug: 'bow-feat', rules: [] } },
        {
          ...bow,
          _id: 'granted-bow',
          system: { ...bow.system, selectedAmmoId: 'arrows' }
        }
      ],
      system: {
        actions: [
          {
            ...bowStrike(false),
            // The strike points at the feat; the feat points at the weapon.
            item: { _id: 'feat-1' }
          }
        ]
      }
    })
  }

  it('resolves the strike through the feat to the granted weapon', () => {
    const actor = grantedBow()
    ;(
      actor.value as unknown as { items: { _id: string; itemGrants?: string[] }[] }
    ).items[0].itemGrants = ['granted-bow']
    const { strikes } = useCharacterStrikes(actor)
    // The strike model surfaces the weapon the resolver found, not the feat the
    // rule element named.
    expect(strikes.value?.[0]?.item?._id).toBe('granted-bow')
  })

  it('writes the ammo selection to the weapon, not to the feat', async () => {
    const actor = grantedBow()
    ;(
      actor.value as unknown as { items: { _id: string; itemGrants?: string[] }[] }
    ).items[0].itemGrants = ['granted-bow']
    const { strikes } = useCharacterStrikes(actor)

    await strikes.value?.[0]?.changeAmmo?.('bolts')

    expect(updateActorItem).toHaveBeenCalledTimes(1)
    expect(updateActorItem.mock.calls[0][1]).toBe('granted-bow')
  })
})
