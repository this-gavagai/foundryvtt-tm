<script setup lang="ts">
import type { Item, FeatCategory, Actor } from '@/utils/pf2e-types'
import { inject, ref, computed } from 'vue'
import { capitalize, removeUUIDs, printPrice } from '@/utils/utilities'

import InfoModal from '@/components/InfoModal.vue'

const infoModal = ref()
const actor: any = inject('actor')
const viewedItem = computed(
  () => actor.value.items?.find((i: any) => i._id === infoModal?.value?.itemId)
)

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
        <div class="relative" @click="infoModal.open(null, feat.feat._id)">
          <span class="text-xs text-gray-500 absolute text-right w-4 pt-1">{{
            feat.level ?? feat.feat.system.level.value
          }}</span
          ><span class="pl-6 cursor-pointer">{{ feat.feat?.name }}</span>
        </div>
        <div
          v-for="grant in feat.feat?.flags?.pf2e?.itemGrants"
          class="ml-10 cursor-pointer"
          @click="infoModal.open(null, grant.id)"
        >
          {{ actor.items.find((i: any) => i._id == grant.id)?.name }}
        </div>
      </dd>
    </dl>
  </div>
  <Teleport to="#modals">
    <InfoModal
      ref="infoModal"
      :imageUrl="viewedItem?.img"
      :traits="viewedItem?.system.traits.value"
    >
      <template #title>
        {{ viewedItem?.name }}
      </template>
      <template #description>
        Level {{ viewedItem?.system?.level?.value ?? '-' }}
        <span class="text-sm">({{ capitalize(viewedItem?.system.traits.rarity) }})</span>
      </template>
      <template #body>
        <div v-html="removeUUIDs(viewedItem?.system.description.value)"></div>
      </template>
    </InfoModal>
  </Teleport>
</template>
