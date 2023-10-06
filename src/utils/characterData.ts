import { ref, toValue, watchEffect } from 'vue'
import { type Actor, type Item } from '@/utils/pf2e-types'

export interface modSet {
  str: number
  dex: number
  con: number
  int: number
  wis: number
  cha: number
}

export function useAttributeScores(actor: () => Actor) {
  // console.log('computing attributes')
  const mods: modSet = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }
  // watchEffect(() => {
  //   // ancestry
  //   const ancestry = toValue(actor)?.items?.find((i: Item) => i.type === 'ancestry')
  //   if (ancestry?.system) {
  //     if (ancestry.system.alternateAncestryBoosts) {
  //       ancestry.system.alternateAncestryBoosts?.forEach((b: keyof modSet) => mods[b]++)
  //     } else {
  //       mods[ancestry.system.boosts[0]?.selected as keyof modSet]++
  //       mods[ancestry.system.boosts[1]?.selected as keyof modSet]++
  //       mods[ancestry.system.boosts[2]?.selected as keyof modSet]++
  //       mods[ancestry.system.flaws[0]?.selected as keyof modSet]++
  //     }
  //   }
  //   // background
  //   const background = toValue(actor)?.items?.find((i: Item) => i.type === 'background')
  //   mods[background?.system?.boosts[0]?.selected as keyof modSet]++
  //   mods[background?.system?.boosts[1]?.selected as keyof modSet]++
  //   // build
  //   const boostGroups = toValue(actor)?.system?.build.attributes.boosts
  //   for (const group in boostGroups) {
  //     boostGroups?.[group]?.forEach((boost: string) => {
  //       mods[boost as keyof modSet]++
  //     })
  //   }
  // })
  return mods
}
