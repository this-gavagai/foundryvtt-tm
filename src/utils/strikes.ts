import type { ElementalBlast, Strike, Weapon } from '@/composables/character'

export type ViewedStrikeTarget =
  | { kind: 'strike'; data: Strike; index: number; altUsage?: number }
  | { kind: 'blast'; data: ElementalBlast; index: number; isMelee: boolean }

export interface ViewedStrike {
  target: ViewedStrikeTarget
  phase: 'attack' | 'damage'
  subtype: number
}

const physicalDamageTypes = new Set(['bludgeoning', 'piercing', 'slashing'])

const attackTypeMap = new Map<boolean | undefined, 'melee' | 'ranged' | undefined>([
  [undefined, undefined],
  [true, 'melee'],
  [false, 'ranged']
])

export function blastDamageType(blast: ElementalBlast): string {
  return (
    blast.damageSelections?.[blast.blastElement ?? ''] ?? blast.blastDamageTypes?.[0]?.value ?? ''
  )
}

export function traitsForViewed(
  viewed: ViewedStrike | undefined,
  viewedItem: Weapon | undefined
): string[] {
  if (!viewed) return []
  const base = (viewed.target.data.traits ?? [])
    .concat(viewed.target.data.weaponTraits ?? [])
    .map((trait) => trait.label ?? '')
  if (viewed.target.kind !== 'blast') return base

  const damageType = blastDamageType(viewed.target.data)
  const extraDamageTrait = damageType && !physicalDamageTypes.has(damageType) ? [damageType] : []
  return base.concat(viewedItem?.system?.traits?.value ?? []).concat(extraDamageTrait)
}

export function damageTypeSelectedForViewed(
  viewed: ViewedStrike | undefined,
  viewedItem: Weapon | undefined
): string | undefined {
  if (!viewed) return undefined
  if (viewed.target.kind === 'blast') return blastDamageType(viewed.target.data)

  return (
    viewedItem?.system?.traits?.toggles?.versatile?.selected ??
    viewedItem?.system?.damage?.damageType ??
    undefined
  )
}

export function damageTypeOptionsForViewed(
  viewed: ViewedStrike | undefined,
  viewedItem: Weapon | undefined
): string[] {
  if (!viewed) return []
  if (viewed.target.kind === 'blast') {
    return viewed.target.data.blastDamageTypes?.map((option) => option.value).filter(isString) ?? []
  }

  if (!viewedItem) return []
  const itemTraits = viewedItem.system?.traits?.value ?? []
  const strikeTraits = (viewed.target.data.weaponTraits ?? [])
    .map((trait) => trait.name)
    .filter(isString)
  const traits = new Set<string>([...itemTraits, ...strikeTraits])

  if (traits.has('modular')) return ['bludgeoning', 'piercing', 'slashing']

  const types = new Set<string>()
  if (viewedItem.system?.damage?.damageType) types.add(viewedItem.system.damage.damageType)
  if (traits.has('versatile-b')) types.add('bludgeoning')
  if (traits.has('versatile-p')) types.add('piercing')
  if (traits.has('versatile-s')) types.add('slashing')
  return Array.from(types)
}

export function variantLabelForViewed(viewed: ViewedStrike | undefined): string {
  if (!viewed) return ''
  return (
    viewed.target.data.variants?.find(
      (variant) =>
        variant.map === viewed.subtype &&
        variant.type ===
          (viewed.target.kind === 'blast' ? attackTypeMap.get(viewed.target.isMelee) : undefined)
    )?.label ?? ''
  )
}

function isString(value: string | undefined | null): value is string {
  return !!value
}
