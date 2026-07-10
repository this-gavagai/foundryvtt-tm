<script setup lang="ts">
import type { Feat } from '@/composables/character'
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useInjectedCharacter } from '@/composables/injectKeys'

import DetailInfoModal from '@/components/DetailInfoModal.vue'
import FeatsListItem from './FeatsListItem.vue'
import SheetSection from '@/components/widgets/SheetSection.vue'

const { t } = useI18n()
const detailModal = ref<InstanceType<typeof DetailInfoModal>>()
const character = useInjectedCharacter()
const { feats, ancestry, background, classType, rollOptionLabels } = character

const viewedFeatId = ref<string | undefined>()
const viewedFeat = computed(() => feats.value?.find((f) => f._id === viewedFeatId.value))

function viewFeat(clickedFeatId: string) {
  viewedFeatId.value = clickedFeatId
  detailModal.value?.open()
}

// The level a feat was taken at, for display order: prefer the explicit
// `taken` level, then the slot suffix in its location (e.g. "class-4"), then
// the feat's own level.
function featSortLevel(feat: Feat): number {
  return (
    feat?.system?.level?.taken ??
    Number(feat?.system?.location?.value?.split('-')?.[1]) ??
    feat?.system?.level?.value ??
    0
  )
}

const featCategories = computed(() => {
  const categories = {
    ancestryfeatures: { label: t('feats.categories.ancestryfeatures'), feats: [] as Feat[] },
    classfeatures: { label: t('feats.categories.classfeatures'), feats: [] as Feat[] },
    ancestry: { label: t('feats.categories.ancestry'), feats: [] as Feat[] },
    class: { label: t('feats.categories.class'), feats: [] as Feat[] },
    archetype: { label: t('feats.categories.archetype'), feats: [] as Feat[] },
    skill: { label: t('feats.categories.skill'), feats: [] as Feat[] },
    general: { label: t('feats.categories.general'), feats: [] as Feat[] },
    xdy_ancestryparagon: { label: t('feats.categories.xdy_ancestryparagon'), feats: [] as Feat[] },
    bonus: { slug: 'bonus', label: t('feats.categories.bonus'), feats: [] as Feat[] }
  }
  feats.value?.forEach((f: Feat) => {
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
  // Sort here (the arrays are freshly built each recompute) rather than in the
  // template, which re-sorted — and mutated — every category on every render.
  Object.values(categories).forEach((category) =>
    category.feats.sort((a, b) => featSortLevel(a) - featSortLevel(b))
  )
  return categories
})
</script>
<template>
  <div data-component="FeatsList">
    <div v-if="feats?.length === 0" class="px-6 pt-4 pb-8 italic">{{ $t('feats.none') }}</div>
    <div v-else class="px-6 pt-4 pb-8 lg:columns-2">
      <SheetSection
        v-for="(category, slug) in featCategories"
        :section="slug"
        :title="category.label"
        class="break-inside-avoid-column overflow-hidden pt-4 [&:not(:has(li))]:hidden"
        :key="slug"
      >
        <ul>
          <li v-for="feat in category.feats" :key="feat._id">
            <FeatsListItem :featId="feat._id" @clicked="viewFeat" />
          </li>
        </ul>
      </SheetSection>
    </div>
    <DetailInfoModal ref="detailModal" :item="viewedFeat" :labels="rollOptionLabels" />
  </div>
</template>
