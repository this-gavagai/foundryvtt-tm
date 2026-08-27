import type { Maybe } from '@/composables/character/helpers'
import type {
  AttackAction,
  ElementalBlast as PF2eElementalBlast,
  ElementalBlastConfig,
  MeleePF2e,
  RawModifier,
  Statistic,
  TraitViewData,
  WeaponPF2e
} from '@7h3laughingman/pf2e-types'
import { type Modifier, makeModifiers } from './modifier'
import { type Weapon, makeWeapon } from './weapon'
import type { DiceResults, RequestResolutionArgs } from '@/types/api-types'
import type DocumentSocketResponse from '@7h3laughingman/foundry-types/common/abstract/socket.mjs'

interface BlastOptions {
  element: Maybe<string>
  damageType: Maybe<string>
  isMelee: Maybe<boolean>
}

export interface Strike {
  label: Maybe<string>
  slug: Maybe<string>
  item?: Maybe<Weapon>
  variants: { label: Maybe<string>; map: Maybe<number>; type: Maybe<'melee' | 'ranged'> }[]
  altUsages: Maybe<Strike>[]
  traits: { name: Maybe<string>; label: Maybe<string>; description: Maybe<string> }[]
  weaponTraits: { name: Maybe<string>; label: Maybe<string>; description: Maybe<string> }[]
  ammunition?: {
    compatible: { id: string; name: string }[]
    selected: { id: string }
  }
  reloadable?: Maybe<boolean>
  loaded?: Maybe<boolean>
  reloadActions?: Maybe<string>
  ready?: Maybe<boolean>
  visible?: Maybe<boolean>
  _modifiers: Maybe<Modifier[]>

  getDamage?: (
    altUsage?: number | undefined,
    blastOptions?: BlastOptions,
    modifierOverrides?: Record<string, boolean>
  ) => Promise<RequestResolutionArgs | null>
  doStrike?: (
    variant: number,
    altUsage: number | undefined,
    blastOptions?: BlastOptions | undefined,
    result?: number | undefined,
    modifierOverrides?: Record<string, boolean>
  ) => Promise<RequestResolutionArgs | null>
  doDamage?: (
    variant: number,
    altUsage: number | undefined,
    blastOptions?: BlastOptions,
    result?: DiceResults,
    modifierOverrides?: Record<string, boolean>
  ) => Promise<RequestResolutionArgs | null>
  setDamageType?: (newType: string) => Promise<DocumentSocketResponse | null>
  changeAmmo?: (newId: string | null) => Promise<unknown>
  setLoaded?: (loaded: boolean) => Promise<RequestResolutionArgs | null>
}

// What makeStrike reads off an attack.
//
// AttackAction is PF2e's own union for what shows up in `altUsages` — a strike or
// an area attack — and only `label` is read off a variant, which both carry.
// `visible` and `weaponTraits` live on BasicAttackData, which PF2e mixes into a
// CHARACTER's attacks and does not export; an NPC's strike has neither, hence
// optional. `selectedAmmoId` likewise: only a character's strike carries one.
export type StrikeSource = AttackAction & {
  visible?: boolean
  weaponTraits?: TraitViewData[]
  selectedAmmoId?: string | null
}

export function makeStrike(
  root: StrikeSource | undefined,
  item: WeaponPF2e | MeleePF2e | undefined
): Strike | undefined {
  if (!root) return undefined
  return {
    label: root?.label,
    slug: root?.slug,
    item: item ? makeWeapon(item) : undefined,
    ready: root?.ready,
    visible: root?.visible,
    variants: root?.variants.map((v, i) => ({ label: v?.label, map: i, type: undefined })),
    // `?? []` because PF2e declares altUsages optional and an NPC's strike sets
    // it to never — where a character's strike always has the array. The Strike
    // contract says a list, and the sheet iterates it.
    altUsages: (root?.altUsages ?? []).map((a) => makeStrike(a, a.item)),
    traits: root?.traits?.map((t) => ({
      name: t?.name,
      label: t?.label,
      description: t?.description ?? undefined
    })),
    weaponTraits: (root?.weaponTraits ?? []).map((t) => ({
      name: t?.name,
      label: t?.label,
      description: t?.description ?? undefined
    })),
    ammunition: {
      compatible:
        root?.ammunition?.compatible?.map((c: { id: string; label: string }) => ({
          id: c.id,
          name: c.label
        })) ?? [],
      // PF2e's strike carries the chosen ammo as `selectedAmmoId`; bind to it
      // rather than `ammunition.selected`, which for reload weapons reflects the
      // physically-loaded subitem (not what the dropdown sets).
      selected: { id: root?.selectedAmmoId ?? '' }
    },
    // PF2e's StatisticModifier exposes `modifiers` as a prototype getter over a
    // PROTECTED `_modifiers`. JSON serialization captures only own enumerable
    // properties, so after the socket round-trip the getter is gone and the
    // array is reachable only under its underscored name — which upstream will
    // not let anything outside the class see, hence the assertion. What the app
    // holds is that class's serialized data, not an instance of it.
    _modifiers: makeModifiers(
      root?.modifiers ?? (root as { _modifiers?: RawModifier[] } | undefined)?._modifiers
    )
  }
}

export interface ElementalBlast extends Strike {
  isBlast: Maybe<boolean>
  blastImg: Maybe<string>
  blastElement: Maybe<string>
  blastRange: { increment: Maybe<number>; max: Maybe<number>; label: Maybe<string> }
  blastDamageTypes: { value: Maybe<string>; label: Maybe<string> }[]
  damageSelections: Record<string, Maybe<string>>
  blastItemId: Maybe<string>
}

export function makeElementalBlasts(root: PF2eElementalBlast | undefined): ElementalBlast[] {
  if (!root) return []
  return root.configs.map((config: ElementalBlastConfig) => ({
    isBlast: true,
    blastElement: config?.element,
    blastRange: {
      increment: config?.range?.increment ?? undefined,
      max: config?.range?.max ?? undefined,
      label: config?.range?.label
    },
    blastDamageTypes: config?.damageTypes.map((d) => ({ value: d?.value, label: d?.label })),
    blastImg: config?.img,
    damageSelections: {
      ...((config?.item?.flags?.pf2e?.damageSelections as Record<string, string> | undefined) ?? {})
    },
    label: `Elemental Blast (${config?.element})`,
    slug: undefined,
    item: undefined,
    blastItemId: config?.item?._id ?? undefined,
    variants: [
      { label: config?.maps?.melee.map0, map: 0, type: 'melee' },
      { label: config?.maps?.melee.map1, map: 1, type: 'melee' },
      { label: config?.maps?.melee.map2, map: 2, type: 'melee' },
      { label: config?.maps?.ranged.map0, map: 0, type: 'ranged' },
      { label: config?.maps?.ranged.map1, map: 1, type: 'ranged' },
      { label: config?.maps?.ranged.map2, map: 2, type: 'ranged' }
    ],
    altUsages: [],
    traits: [],
    weaponTraits: [],
    _modifiers: makeModifiers(
      config?.statistic?.modifiers ??
        (config.statistic as Statistic & { _modifiers?: RawModifier[] })?._modifiers
    )
  }))
}
