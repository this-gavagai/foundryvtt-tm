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

vi.mock('@/api/actionRpc', () => ({
  rollCheck: vi.fn(() => Promise.resolve(null)),
  getStrikeDamage: vi.fn(() => Promise.resolve(null)),
  toggleKineticAura: vi.fn(() => Promise.resolve(null)),
  setWeaponDamageType: (...args: unknown[]) => setWeaponDamageType(...args),
  setWeaponLoaded: (...args: unknown[]) => setWeaponLoaded(...args)
}))
vi.mock('@/api/documents', () => ({
  recoverFailedWrite: vi.fn(),
  updateActorItem: vi.fn(() => Promise.resolve(null))
}))

const { useCharacterStrikes } = await import('@/composables/character/characterStrikes')

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
