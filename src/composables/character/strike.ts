import type { Maybe } from './helpers'
import type {
  CharacterStrike,
  ElementalBlast as PF2eElementalBlast,
  ElementalBlastConfig,
  ItemPF2e
} from '@7h3laughingman/pf2e-types'
import { type Modifier, makeModifiers } from './modifier'
import { type Item, makeItem } from './item'
import type { RequestResolutionArgs } from '@/types/api-types'
import type DocumentSocketResponse from '@7h3laughingman/foundry-types/common/abstract/socket.mjs'

interface BlastOptions {
  element: Maybe<string>
  damageType: Maybe<string>
  isMelee: Maybe<boolean>
}

export interface Strike {
  label: Maybe<string>
  slug: Maybe<string>
  item?: Maybe<Item>
  variants: { label: Maybe<string>; map: Maybe<number>; type: Maybe<'melee' | 'ranged'> }[]
  altUsages: Maybe<Strike>[]
  traits: { name: Maybe<string>; label: Maybe<string>; description: Maybe<string> }[]
  weaponTraits: { name: Maybe<string>; label: Maybe<string>; description: Maybe<string> }[]
  ammunition?: {
    compatible: { id: string; name: string }[]
    selected: { id: string }
  }
  _modifiers: Maybe<Modifier[]>

  getDamage?: (
    altUsage?: number | undefined,
    blastOptions?: BlastOptions
  ) => Promise<RequestResolutionArgs | null>
  doStrike?: (
    variant: number,
    altUsage: number | undefined,
    blastOptions?: BlastOptions | undefined,
    result?: number | undefined
  ) => Promise<RequestResolutionArgs | null>
  doDamage?: (
    variant: number,
    altUsage: number | undefined,
    blastOptions?: BlastOptions
  ) => Promise<RequestResolutionArgs | null>
  setDamageType?: (newType: string) => Promise<DocumentSocketResponse | null>
  changeAmmo?: (newId: string | null) => Promise<DocumentSocketResponse | null>
}

export function makeStrike(
  root: CharacterStrike | undefined,
  item: ItemPF2e | undefined
): Strike | undefined {
  if (!root) return undefined
  return {
    label: root?.label,
    slug: root?.slug,
    item: makeItem(item),
    variants: root?.variants.map((v, i) => ({ label: v?.label, map: i, type: undefined })),
    altUsages: root?.altUsages?.map((a) => makeStrike(a as CharacterStrike, a.item)),
    traits: root?.traits?.map((t) => ({
      name: t?.name,
      label: t?.label,
      description: t?.description ?? undefined
    })),
    weaponTraits: root?.weaponTraits?.map((t) => ({
      name: t?.name,
      label: t?.label,
      description: t?.description ?? undefined
    })),
    ammunition: {
      compatible: root?.ammunition?.compatible?.map((c: { id: string; label: string }) => ({
        id: c.id,
        name: c.label
      })) ?? [],
      selected: { id: root?.ammunition?.selected?.id ?? '' }
    },
    _modifiers: makeModifiers(root?.modifiers as unknown as Parameters<typeof makeModifiers>[0])
  }
}

export interface ElementalBlast extends Strike {
  isBlast: Maybe<boolean>
  blastImg: Maybe<string>
  blastElement: Maybe<string>
  blastRange: { increment: Maybe<number>; max: Maybe<number>; label: Maybe<string> }
  blastDamageTypes: { value: Maybe<string>; label: Maybe<string> }[]
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
    label: `Elemental Blast (${config?.element})`,
    slug: undefined,
    item: makeItem(config?.item),
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
    _modifiers: makeModifiers(config?.statistic?.modifiers as unknown as Parameters<typeof makeModifiers>[0])
  }))
}
