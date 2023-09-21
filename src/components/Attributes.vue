<script setup lang="ts">
import { computed } from 'vue'
import { type Item, type Actor } from '@/utils/pf2e-types'
import Statistic from './Statistic.vue'
import { SignedNumber } from '@/utils/utilities'
import { useAttributeScores, type modSet } from '@/utils/characterData'
const props = defineProps(['actor'])

const attributes = [
  { heading: 'Str', abbr: 'str' },
  { heading: 'Dex', abbr: 'dex' },
  { heading: 'Con', abbr: 'con' },
  { heading: 'Int', abbr: 'int' },
  { heading: 'Wis', abbr: 'wis' },
  { heading: 'Cha', abbr: 'cha' }
]

const attrMods = useAttributeScores((): Actor => props.actor)
// const attrMods = computed(() => {
//   // todo: there's a lot that's missing here, including status effects and apex items
//   const mods: modSet = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }
//   // ancestry
//   const ancestry = props.actor?.items?.find((i: Item) => i.type === 'ancestry')
//   if (ancestry?.system) {
//     if (ancestry.system.alternateAncestryBoosts) {
//       ancestry.system.alternateAncestryBoosts.forEach((b: keyof modSet) => mods[b]++)
//     } else {
//       mods[ancestry.system.boosts[0]?.selected as keyof modSet]++
//       mods[ancestry.system.boosts[1]?.selected as keyof modSet]++
//       mods[ancestry.system.boosts[2]?.selected as keyof modSet]++
//       mods[ancestry.system.flaws[0]?.selected as keyof modSet]++
//     }
//   }
//   // background
//   const background = props.actor?.items?.find((i: Item) => i.type === 'background')
//   mods[background?.system?.boosts[0]?.selected as keyof modSet]++
//   mods[background?.system?.boosts[1]?.selected as keyof modSet]++
//   // build
//   const boostGroups = props.actor?.system?.build.attributes.boosts
//   for (const group in boostGroups) {
//     boostGroups[group].forEach((boost: string) => {
//       mods[boost as keyof modSet]++
//     })
//   }
//   return mods
// })
</script>
<template>
  <div>
    <Statistic v-for="attr in attributes" :heading="attr.heading">
      {{
        // !isNaN(Number(props.actor.system?.abilities?.[attr.abbr]?.base))
        //   ? SignedNumber.format(props.actor.system?.abilities?.[attr.abbr]?.base)
        //   : '??'
        SignedNumber.format(attrMods?.[attr?.abbr as keyof modSet] ?? 0)
      }}
    </Statistic>
    <!-- <Statistic heading="Str">
      {{ SignedNumber.format(actor.system?.abilities?.str?.base) }}
    </Statistic>
    <Statistic heading="Dex">
      {{ SignedNumber.format(actor.system?.abilities?.dex?.base) || '??' }}
    </Statistic>
    <Statistic heading="Con">
      {{ SignedNumber.format(actor.system?.abilities?.con?.base) || '??' }}
    </Statistic>
    <Statistic heading="Int">
      {{ SignedNumber.format(actor.system?.abilities?.int?.base) || '??' }}
    </Statistic>
    <Statistic heading="Wis">
      {{ SignedNumber.format(actor.system?.abilities?.wis?.base) || '??' }}
    </Statistic>
    <Statistic heading="Cha">
      {{ SignedNumber.format(actor.system?.abilities?.cha?.base) || '??' }}
    </Statistic> -->
  </div>
</template>
