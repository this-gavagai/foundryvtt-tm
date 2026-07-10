<script setup lang="ts">
import type { Action } from '@/composables/character'
import { computed, ref } from 'vue'
import { useInjectedFamiliar } from '@/composables/injectKeys'

import ActionIcons from '@/components/widgets/ActionIcons.vue'
import ViewableItem from '@/components/widgets/ViewableItem.vue'
import DetailInfoModal from '@/components/DetailInfoModal.vue'

const familiar = useInjectedFamiliar()
const { actions, rollOptionLabels } = familiar

const detailModal = ref<InstanceType<typeof DetailInfoModal>>()

const actionViewedId = ref<string | undefined>()
const actionViewed = computed(() => actions.value?.find((a) => a._id === actionViewedId.value))

function viewAction(action: Action) {
  actionViewedId.value = action._id
  detailModal.value?.open()
}
</script>
<template>
  <div data-component="FamiliarActionsList" class="px-6 py-4">
    <section data-section="abilities" class="[&:not(:has(li))]:hidden">
      <h3 class="mb-[0.6rem] pb-2 text-[1.1rem] font-normal tracking-[0.01em]">Abilities</h3>
      <ul class="space-y-1">
        <li v-for="action in actions" :key="action._id">
          <ViewableItem scale="firm" class="inline-block" @click="viewAction(action)">
            {{ action.name }}
            <ActionIcons
              v-if="action.actionType !== 'passive'"
              class="relative -mt-2 pl-1 text-2xl leading-4"
              :actions="
                action.actionType === 'reaction'
                  ? 'r'
                  : action.actionType === 'free'
                    ? 'f'
                    : (action?.system?.actions?.value?.toString() ?? '')
              "
            />
          </ViewableItem>
        </li>
      </ul>
    </section>
    <div v-if="actions?.length === 0" class="py-8 text-center text-sm text-gray-500">
      No familiar abilities.
    </div>
    <DetailInfoModal ref="detailModal" :item="actionViewed" :labels="rollOptionLabels">
      <template #description>
        <span v-if="actionViewed?.actionType === 'passive'">Passive</span>
      </template>
    </DetailInfoModal>
  </div>
</template>
