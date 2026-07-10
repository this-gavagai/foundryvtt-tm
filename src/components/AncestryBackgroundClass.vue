<script setup lang="ts">
import type { Item } from '@/composables/character'
import { ref, computed } from 'vue'
import DetailInfoModal from '@/components/DetailInfoModal.vue'
import ParsedDescription from './ParsedDescription.vue'
import ViewableItem from '@/components/widgets/ViewableItem.vue'
import { useInjectedCharacter } from '@/composables/injectKeys'

const detailModal = ref<InstanceType<typeof DetailInfoModal>>()
const character = useInjectedCharacter()
const { ancestry, heritage, background, classType, level, rollOptionLabels } = character
const identityViewedId = ref<string | undefined>()
const identityViewed = computed(
  () =>
    [ancestry, heritage, background, classType].find((i) => i.value?._id === identityViewedId.value)
      ?.value
)
function viewItem(item: Item | undefined) {
  identityViewedId.value = item?._id
  if (item) detailModal.value?.open()
}
</script>
<template>
  <div>
    <div class="my-auto shrink">
      <div class="overflow-hidden whitespace-nowrap">
        <ViewableItem class="inline-block" @click="viewItem(ancestry)"
          >{{ ancestry?.name ?? '-' }}&nbsp;</ViewableItem
        >
        <ViewableItem class="inline-block" @click="viewItem(background)">{{
          background?.name
        }}</ViewableItem>
      </div>
      <div class="overflow-hidden whitespace-nowrap">
        <ViewableItem class="inline-block" @click="viewItem(classType)">
          <span>{{ classType?.name ?? '-' }}</span>
          <span v-if="level && classType?.name">{{ ` (${$t('common.level')} ${level})` }}</span>
        </ViewableItem>
      </div>
    </div>
    <DetailInfoModal ref="detailModal" :item="identityViewed" :labels="rollOptionLabels">
      <template #bodyExtra>
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
    </DetailInfoModal>
  </div>
</template>
