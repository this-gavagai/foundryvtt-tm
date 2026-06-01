<script setup lang="ts">
import type { Feat } from '@/composables/character'
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { useRollsFromActiveRoll } from '@/composables/useRollsFromActiveRoll'

import InfoModal from '@/components/InfoModal.vue'
import FeatsListItem from './FeatsListItem.vue'
import ParsedDescription from './ParsedDescription.vue'

const { t } = useI18n()
const infoModal = ref()
const description = ref()
const character = useInjectedCharacter()
const { feats, ancestry, background, classType, rollOptionLabels } = character

const viewedFeatId = ref<string | undefined>()
const viewedFeat = computed(() => feats.value?.find((f) => f._id === viewedFeatId.value))
const inlineRolls = useRollsFromActiveRoll(computed(() => description.value?.activeRoll))

function viewFeat(clickedFeatId: string) {
  viewedFeatId.value = clickedFeatId
  infoModal.value.open()
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
  return categories
})
</script>
<template>
  <div data-component="FeatsList">
    <div v-if="feats?.length === 0" class="px-6 py-4 italic">{{ $t('feats.none') }}</div>
    <div v-else class="px-6 py-4 lg:columns-2">
      <dl
        v-for="(category, slug) in featCategories"
        :data-section="slug"
        class="break-inside-avoid-column overflow-hidden pb-4 [&:not(:has(dd))]:hidden"
        :key="slug"
      >
        <dt class="text-lg underline only:hidden">
          {{ category.label }}
        </dt>
        <dd
          v-for="feat in category.feats.sort(
            (a, b) =>
              (a?.system?.level?.taken ??
                Number(a?.system?.location?.value?.split('-')?.[1]) ??
                a?.system?.level?.value ??
                0) -
              (b?.system?.level?.taken ??
                Number(b?.system?.location?.value?.split('-')?.[1]) ??
                b?.system?.level?.value ??
                0)
          )"
          :key="feat._id"
        >
          <FeatsListItem :featId="feat._id" @clicked="viewFeat" />
        </dd>
      </dl>
    </div>
    <Teleport to="#modals">
      <InfoModal
        ref="infoModal"
        :itemId="viewedFeat?._id"
        :imageUrl="viewedFeat?.img"
        :traits="viewedFeat?.system?.traits?.value"
        :rolls="inlineRolls"
      >
        <template #title>
          {{ viewedFeat?.name }}
        </template>
        <template #description>
          <div class="flex gap-1">
            <span v-if="viewedFeat?.system?.level?.value" class="inline-block">
              {{ $t('common.level') }} {{ viewedFeat?.system?.level?.value ?? '-' }}
            </span>
            <span v-if="viewedFeat?.system?.traits?.rarity" class="inline-block">
              <span class="text-sm capitalize">({{ viewedFeat?.system.traits.rarity }})</span>
            </span>
          </div>
        </template>
        <template #body>
          <ParsedDescription
            ref="description"
            :text="viewedFeat?.system?.description.value"
            :labels="rollOptionLabels"
            :itemId="viewedFeat?._id ?? undefined"
          />
        </template>
      </InfoModal>
    </Teleport>
  </div>
</template>
