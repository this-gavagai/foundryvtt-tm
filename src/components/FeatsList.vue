<script setup lang="ts">
import type { Item } from '@/composables/character'
import { inject, ref, computed } from 'vue'
import { removeUUIDs } from '@/utils/utilities'
import { useKeys } from '@/composables/injectKeys'

import InfoModal from '@/components/InfoModal.vue'
import FeatsListItem from './FeatsListItem.vue'

const infoModal = ref()
const character = inject(useKeys().characterKey)!
const { feats, ancestry, background, classType } = character

const viewedFeatId = ref<string | undefined>()
// const viewedFeat = ref<Item | undefined>()
const viewedFeat = computed(() => feats.value?.find((f) => f._id === viewedFeatId.value))

const featCategories = computed(() => {
  const categories = {
    ancestryfeatures: { label: 'Ancestry Features', feats: [] as Item[] },
    classfeatures: { label: 'Class Features', feats: [] as Item[] },
    ancestry: { label: 'Ancestry Feats', feats: [] as Item[] },
    class: { label: 'Class Feats', feats: [] as Item[] },
    archetype: { label: 'Archetype Feats', feats: [] as Item[] },
    skill: { label: 'Skill Feats', feats: [] as Item[] },
    general: { label: 'General Feats', feats: [] as Item[] },
    xdy_ancestryparagon: { label: 'Ancestry Paragon', feats: [] as Item[] },
    bonus: { slug: 'bonus', label: 'Bonus Feats', feats: [] as Item[] }
  }
  feats.value?.forEach((f: Item) => {
    if (feats.value?.map((n) => n._id).includes(f?.grantedBy)) return
    else if (
      ['ancestryfeature', ancestry.value?._id].includes(f?.system?.location?.value) ||
      f?.system?.category === 'ancestryfeature'
    )
      categories['ancestryfeatures']?.feats.push(f)
    else if (['classfeature', classType.value?._id].includes(f?.system?.location?.value))
      categories['classfeatures']?.feats.push(f)
    else if (f?.system?.location?.value?.split('-')[0] === 'ancestry')
      categories['ancestry']?.feats.push(f)
    else if (f?.system?.location?.value?.split('-')[0] === 'class')
      categories['class']?.feats.push(f)
    else if (f?.system?.location?.value?.split('-')[0] === 'archetype')
      categories['archetype']?.feats.push(f)
    else if (
      f?.system?.location?.value?.split('-')[0] === 'skill' ||
      f?.system?.location?.value === background.value?._id
    )
      categories['skill']?.feats.push(f)
    else if (f?.system?.location?.value?.split('-')[0] === 'general')
      categories['general']?.feats.push(f)
    else if (f?.system?.location?.value?.split('-')[0] === 'xdy_ancestryparagon')
      categories['xdy_ancestryparagon']?.feats.push(f)
    else categories['bonus']?.feats.push(f)
  })
  return categories
})
</script>
<template>
  <div v-if="feats?.length === 0" class="px-6 py-4 italic">This character has no feats.</div>
  <div v-else class="px-6 py-4 lg:columns-2">
    <dl
      v-for="(category, slug) in featCategories"
      class="break-inside-avoid-column overflow-hidden"
      :key="slug"
    >
      <dt class="pt-2 text-lg underline only:hidden">
        {{ category.label }}
      </dt>
      <dd v-for="feat in category.feats" :key="feat._id">
        <FeatsListItem
          :featId="feat._id"
          @clicked="
            (clickedFeatId: string) => {
              console.log('outside', clickedFeatId)
              viewedFeatId = clickedFeatId
              infoModal.open()
            }
          "
        />
      </dd>
    </dl>
  </div>
  <Teleport to="#modals">
    <InfoModal
      ref="infoModal"
      :itemId="viewedFeat?._id"
      :imageUrl="viewedFeat?.img"
      :traits="viewedFeat?.system?.traits?.value"
    >
      <template #title>
        {{ viewedFeat?.name }}
      </template>
      <template #description>
        <div class="flex gap-1">
          <span v-if="viewedFeat?.system?.level?.value" class="inline-block">
            Level {{ viewedFeat?.system?.level?.value ?? '-' }}
          </span>
          <span v-if="viewedFeat?.system?.traits?.rarity" class="inline-block">
            <span class="text-sm capitalize">({{ viewedFeat?.system.traits.rarity }})</span>
          </span>
        </div>
      </template>
      <template #body>
        <div v-html="removeUUIDs(viewedFeat?.system?.description.value)"></div>
      </template>
    </InfoModal>
  </Teleport>
</template>
