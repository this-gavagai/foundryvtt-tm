<script setup lang="ts">
// TODO: make feat nesting recursive instead of manual like it is now
// TODO: Bad formatting for Schmitz’s first feat’s header. Land on your feet.
import type { Item } from '@/composables/character'
import { inject, ref, computed } from 'vue'
import { capitalize, removeUUIDs } from '@/utils/utilities'
import { useKeys } from '@/composables/injectKeys'

import InfoModal from '@/components/InfoModal.vue'

const infoModal = ref()
const character = inject(useKeys().characterKey)!
const { feats, ancestry, background, classType } = character

const viewedItem = computed(() =>
  feats.value?.find((i: Item) => i?._id === infoModal?.value?.itemId)
)

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
      ['ancestryfeature', ancestry.value?._id].includes(f?.system?.location) ||
      f?.system?.category === 'ancestryfeature'
    )
      categories['ancestryfeatures']?.feats.push(f)
    else if (['classfeature', classType.value?._id].includes(f?.system?.location))
      categories['classfeatures']?.feats.push(f)
    else if (f?.system?.location?.split('-')[0] === 'ancestry')
      categories['ancestry']?.feats.push(f)
    else if (f?.system?.location?.split('-')[0] === 'class') categories['class']?.feats.push(f)
    else if (f?.system?.location?.split('-')[0] === 'archetype')
      categories['archetype']?.feats.push(f)
    else if (
      f?.system?.location?.split('-')[0] === 'skill' ||
      f?.system?.location === background.value?._id
    )
      categories['skill']?.feats.push(f)
    else if (f?.system?.location?.split('-')[0] === 'general') categories['general']?.feats.push(f)
    else if (f?.system?.location?.split('-')[0] === 'xdy_ancestryparagon')
      categories['xdy_ancestryparagon']?.feats.push(f)
    else categories['bonus']?.feats.push(f)
  })
  return categories
})
</script>
<template>
  <div class="px-6 py-4 lg:columns-2">
    <dl v-for="(category, slug) in featCategories" class="break-inside-avoid-column" :key="slug">
      <dt class="pt-2 text-lg underline only:hidden">
        {{ category.label }}
      </dt>
      <dd v-for="feat in category.feats" :key="feat._id">
        <div class="relative">
          <a class="cursor-pointer" @click="infoModal.open(feat._id)">
            <span class="absolute w-4 pt-1 text-right text-xs text-gray-500">{{
              feat?.system?.level?.taken ??
              feat?.system?.location?.split('-')?.[1] ??
              feat.system?.level?.value
            }}</span
            ><span class="pl-6">{{ feat?.name }}</span>
          </a>
        </div>
        <!-- bad manual recursion -->
        <div v-for="grant in feat?.itemGrants" :key="grant">
          <div class="ml-10">
            <a class="cursor-pointer" @click="infoModal.open(grant)">
              {{ feats?.find((i: Item) => i._id == grant)?.name }}
            </a>
            <div
              v-for="grant2 in feats?.find((i: Item) => i._id == grant)?.itemGrants"
              :key="grant2"
            >
              <div class="ml-5">
                <a class="cursor-pointer" @click="infoModal.open(grant2)">
                  {{ feats?.find((i: Item) => i._id == grant2)?.name }}
                </a>
                <div
                  v-for="grant3 in feats?.find((i: Item) => i._id == grant2)?.itemGrants"
                  :key="grant3"
                >
                  <div class="ml-5">
                    <a class="cursor-pointer" @click="infoModal.open(grant3)">
                      {{ feats?.find((i: Item) => i._id == grant3)?.name }}
                    </a>
                    <div
                      v-for="grant4 in feats?.find((i: Item) => i._id == grant3)?.itemGrants"
                      :key="grant4"
                    >
                      <div class="ml-5">
                        <a class="cursor-pointer" @click="infoModal.open(grant4)">
                          {{ feats?.find((i: Item) => i._id == grant4)?.name }}
                        </a>
                        <div
                          v-for="grant5 in feats?.find((i: Item) => i._id == grant4)?.itemGrants"
                          :key="grant5"
                        >
                          <div class="ml-5">
                            <a class="cursor-pointer" @click="infoModal.open(grant5)">
                              {{ feats?.find((i: Item) => i._id == grant5)?.name }}
                            </a>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </dd>
    </dl>
  </div>
  <Teleport to="#modals">
    <InfoModal
      ref="infoModal"
      :imageUrl="viewedItem?.img"
      :traits="viewedItem?.system?.traits?.value"
    >
      <template #title>
        {{ viewedItem?.name }}
      </template>
      <template #description>
        <span v-if="viewedItem?.system?.level?.value" class="inline-block">
          Level {{ viewedItem?.system?.level?.value ?? '-' }}
        </span>
        <span v-if="viewedItem?.system?.traits?.rarity" class="inline-block">
          <span class="text-sm">({{ capitalize(viewedItem?.system.traits.rarity) }})</span>
        </span>
      </template>
      <template #body>
        <div v-html="removeUUIDs(viewedItem?.system?.description.value)"></div>
      </template>
    </InfoModal>
  </Teleport>
</template>
