<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Action } from '@/composables/character'
import { useInjectedCharacter } from '@/composables/injectKeys'

import SheetSection from '@/components/widgets/SheetSection.vue'
import ViewableItem from '@/components/widgets/ViewableItem.vue'
import DetailInfoModal from '@/components/DetailInfoModal.vue'

// What the character can do with days rather than minutes: Craft, Earn Income,
// Retraining, Long-Term Rest.
//
// The quiet sibling of ExplorationList, and deliberately quieter: there is no
// active mark here because PF2e stores none (see the downtime block in
// useCharacterActions). Every row is a reference card — tap the name, read what
// it takes and what it earns — which is exactly what a player needs a downtime
// list for at the table, since the days themselves are the GM's to run.

const character = useInjectedCharacter()
const { downtimeActivities, rollOptionLabels } = character

const detailModal = ref<InstanceType<typeof DetailInfoModal>>()

const viewedId = ref<string | undefined>()
const viewed = computed(() => downtimeActivities.value?.find((a) => a._id === viewedId.value))

function view(activity: Action) {
  viewedId.value = activity._id
  detailModal.value?.open()
}
</script>

<template>
  <div data-component="DowntimeList">
    <!-- Hidden outright when the character has no downtime activities on the
           sheet, as every other action group hides: an empty panel would read
           as "you can't do this", which isn't true — Craft and Earn Income
           just haven't been added to the sheet. -->
    <SheetSection
      section="downtime"
      :title="$t('actionTypes.downtime')"
      class="break-inside-avoid-column pt-4 [&:not(:has(li))]:hidden"
    >
      <ul>
        <li v-for="activity in downtimeActivities" :key="activity._id">
          <ViewableItem scale="firm" class="inline-block" @click="view(activity)">
            {{ activity.name }}
          </ViewableItem>
        </li>
      </ul>
    </SheetSection>
    <DetailInfoModal ref="detailModal" :item="viewed" :labels="rollOptionLabels" />
  </div>
</template>
