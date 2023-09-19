<script setup lang="ts">
import type { Item, FeatCategory, Actor } from '@/utils/pf2e-types'
import { inject } from 'vue'
import { makeTraits, capitalize, removeUUIDs, printPrice } from '@/utils/utilities'

const { actor } = defineProps<{ actor: Actor }>()
const infoModal: any = inject('infoModal')

function infoFeat(featId: any) {
  console.log('Feat: ', featId)
  const item = actor.items.find((i) => i._id == featId)
  console.log(item)
  infoModal.value?.open({
    title: item.name,
    description: `Level ${item.system.level.value} <span class="text-sm">(${capitalize(
      item.system.traits.rarity
    )})</span>`,
    body: makeTraits(item.system.traits.value) + removeUUIDs(item.system.description.value),
    iconPath: item.img
  })
}

const categoryLabels = new Map([
  ['PF2E.FeaturesAncestryHeader', 'Ancestry Features'],
  ['PF2E.FeaturesClassHeader', 'Class Features'],
  ['PF2E.FeatAncestryHeader', 'Ancestry Feats'],
  ['PF2E.FeatClassHeader', 'Class Feats'],
  ['PF2E.FeatArchetypeHeader', 'Archetype Feats'],
  ['PF2E.FeatSkillHeader', 'Skill Feats'],
  ['PF2E.FeatGeneralHeader', 'General Feats'],
  ['PF2E.FeatBonusHeader', 'Bonus Feats']
])
</script>
<template>
  <div class="px-6 py-4">
    <h3 class="underline text-2xl">Feats</h3>
    <dl v-for="category in actor.feats">
      <dt class="underline text-lg only:hidden pt-2">
        {{ categoryLabels.get(category.label) ?? category.label }}
      </dt>
      <dd v-for="feat in category.feats">
        <div class="relative" @click="infoFeat(feat.feat._id)">
          <span class="text-xs text-gray-500 absolute text-right w-4 pt-1">{{
            feat.level ?? feat.feat.system.level.value
          }}</span
          ><span class="pl-6">{{ feat.feat.name }}</span>
        </div>
        <div
          v-for="grant in feat.feat.flags?.pf2e?.itemGrants"
          class="ml-10"
          @click="infoFeat(grant.id)"
        >
          {{ actor.items.find((i) => i._id == grant.id).name }}
        </div>
      </dd>
    </dl>
  </div>
</template>
