<script setup lang="ts">
import type { Item } from '@/composables/character'
import { ref, computed } from 'vue'
import InfoModal from '@/components/InfoModal.vue'
import ParsedDescription from './ParsedDescription.vue'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { useRollsFromActiveRoll } from '@/composables/useRollsFromActiveRoll'

const infoModal = ref()
const description = ref()
const character = useInjectedCharacter()
const { ancestry, heritage, background, classType, level, rollOptionLabels } = character
const identityViewedId = ref<string | undefined>()
const identityViewed = computed(
  () =>
    [ancestry, heritage, background, classType].find((i) => i.value?._id === identityViewedId.value)
      ?.value
)
const inlineRolls = useRollsFromActiveRoll(computed(() => description.value?.activeRoll))
function viewItem(item: Item | undefined) {
  identityViewedId.value = item?._id
  if (item) infoModal.value.open()
}
</script>
<template>
  <div>
    <div class="my-auto shrink">
      <div class="cursor-pointer overflow-hidden whitespace-nowrap">
        <span @click="viewItem(ancestry)">{{ ancestry?.name ?? '-' }}&nbsp;</span>
        <span @click="viewItem(background)">{{ background?.name }}</span>
      </div>
      <div class="cursor-pointer overflow-hidden whitespace-nowrap" @click="viewItem(classType)">
        <span>{{ classType?.name ?? '-' }}</span>
        <span v-if="level && classType?.name">{{ ` (Level ${level})` }}</span>
      </div>
    </div>
    <Teleport to="#modals">
      <InfoModal
        ref="infoModal"
        :imageUrl="identityViewed?.img"
        :itemId="identityViewed?._id"
        :traits="identityViewed?.system?.traits?.value"
        :rolls="inlineRolls"
      >
        <template #title>
          {{ identityViewed?.name }}
        </template>
        <template #description>
          <span v-if="identityViewed?.system?.level?.value"
            >{{ $t('common.level') }} {{ identityViewed?.system?.level?.value ?? '-' }}</span
          >
          <span v-if="identityViewed?.system?.traits?.rarity" class="capitalize"
            >({{ identityViewed?.system?.traits?.rarity }})</span
          >
        </template>
        <template #body>
          <ParsedDescription
            ref="description"
            :text="identityViewed?.system?.description?.value"
            :labels="rollOptionLabels"
            :itemId="identityViewed?._id ?? undefined"
          />
          <div v-if="identityViewed?.type === 'ancestry'">
            <hr />
            <div class="mt-2">
              <h3 class="text-lg">{{ heritage?.name }}</h3>
              <ParsedDescription
                :text="heritage?.system?.description?.value"
                :labels="rollOptionLabels"
                :itemId="heritage?._id ?? undefined"
              />
            </div>
          </div>
        </template>
      </InfoModal>
    </Teleport>
  </div>
</template>
