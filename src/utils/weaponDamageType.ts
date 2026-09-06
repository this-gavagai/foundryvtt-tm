// A weapon's effective damage type, when the toggle that decides it is source
// data but the result of applying it is not.
//
// PF2e's `WeaponPF2e#baseDamage`:
//
//   damageType = toggles.versatile.selected
//             ?? toggles.modular?.config.damageType
//             ?? system.damage.damageType
//
// The awkward half is `modular`, which stores an INDEX rather than a type — the
// index is on the item in source (`traits.toggles.modular.selected`), but the
// options array it indexes is built during preparation and never serialized. So
// a sheet painted from the world dump showed a modular weapon's BASE type no
// matter which face the player had selected: one live character's Polytool reads
// bludgeoning in source and piercing once prepared.
//
// The array is a constant, which is what makes this recoverable. PF2e uses a
// per-item override where one exists and otherwise the three physical types, in
// this order.
const MODULAR_TYPES = ['bludgeoning', 'piercing', 'slashing'] as const

export interface DamageTypedWeapon {
  system?: {
    damage?: { damageType?: string | null }
    traits?: {
      value?: string[]
      toggles?: {
        // Declared `Maybe<string>` by the app's PF2e types and written as a
        // NUMBER by both PF2e and this app's own handler. Accepting either is
        // the same defensive reading the strike serializer applies to
        // `_modifiers`: the types are a major version behind the system, and a
        // wrong assumption here silently picks the wrong damage type.
        modular?: { selected?: number | string | null }
        versatile?: { selected?: string | null }
      }
      // An item may carry its own option list; PF2e prefers it when non-empty.
      config?: { modular?: { damageType?: string }[] }
    }
  }
}

export function effectiveDamageType(item: DamageTypedWeapon | undefined): string | undefined {
  const traits = item?.system?.traits
  const base = item?.system?.damage?.damageType ?? undefined

  // Versatile wins outright, and stores the type itself — nothing to resolve.
  const versatile = traits?.toggles?.versatile?.selected
  if (versatile) return versatile

  if (!traits?.value?.includes('modular')) return base

  const options = traits.config?.modular?.length
    ? traits.config.modular.map((option) => option.damageType).filter((t): t is string => !!t)
    : [...MODULAR_TYPES]
  // PF2e defaults the index to 0 and falls back to the first option when the
  // stored index is out of range, rather than to the weapon's own base type.
  const raw = traits.toggles?.modular?.selected
  const selected = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw
  const index = Number.isInteger(selected) ? (selected as number) : 0
  return options[index] ?? options[0] ?? base
}
