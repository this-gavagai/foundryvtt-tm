import type {
  ElementalBlasts as PF2eElementalBlasts,
  ElementalBlastConfig as PF2eElementalBlastConfig
} from '@/types/pf2e-types'
import { type Item, makeItem } from './item'
import { type Stat, makeStat } from './stat'

import type { Maybe } from './helpers'
export interface ElementalBlast {
  actionCost: Maybe<number>
  damageTypes: { value: Maybe<string>; label: Maybe<string> }[]
  element: Maybe<string>
  img: Maybe<string>
  item: Item
  maps: {
    melee: { map0: Maybe<string>; map1: Maybe<string>; map2: Maybe<string> }
    ranged: { map0: Maybe<string>; map1: Maybe<string>; map2: Maybe<string> }
  }
  statistic: Stat
  getBlastDamage?: (
    element: string,
    damageType: string,
    isMelee: boolean
  ) => Promise<unknown> | null
  doBlast?: (
    element: string,
    damageType: string,
    mapIncreases: number,
    isMelee: boolean
  ) => Promise<unknown> | null
  doBlastDamage?: (
    element: string,
    damageType: string,
    outcome: string,
    isMelee: boolean
  ) => Promise<unknown> | null
  setDamageType?: (newType: string) => Promise<unknown> | null
}

export function makeElementalBlasts(root: PF2eElementalBlasts | undefined) {
  if (!root) return undefined
  return root.configs.map((config: PF2eElementalBlastConfig) => ({
    actionCost: config?.actionCost,
    damageTypes: config?.damageTypes.map((d) => ({ value: d?.value, label: d?.label })),
    element: config?.element,
    img: config?.img,
    item: makeItem(config?.item),
    maps: {
      melee: {
        map0: config?.maps?.melee.map0,
        map1: config?.maps?.melee?.map1,
        map2: config?.maps?.melee?.map2
      },
      ranged: {
        map0: config?.maps?.ranged.map0,
        map1: config?.maps?.ranged?.map1,
        map2: config?.maps?.ranged?.map2
      }
    },
    statistic: makeStat(config?.statistic)
  }))
}
