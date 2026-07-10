<script setup lang="ts">
import type { Action } from '@/composables/character'
import { actionTypes } from '@/utils/constants'
import { ref, computed } from 'vue'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { storeToRefs } from 'pinia'
import { useListenersStore } from '@/stores/listenersOnline'

import ActionIcons from '@/components/widgets/ActionIcons.vue'
import ViewableItem from '@/components/widgets/ViewableItem.vue'
import SheetSection from '@/components/widgets/SheetSection.vue'
import Button from './widgets/ButtonWidget.vue'
import DetailInfoModal from '@/components/DetailInfoModal.vue'

const detailModal = ref<InstanceType<typeof DetailInfoModal>>()

const character = useInjectedCharacter()
const { actions, rollOptionLabels } = character

const { isListening } = storeToRefs(useListenersStore())

const actionViewedId = ref<string | undefined>()
const actionViewed = computed(() => actions.value?.find((a) => a._id === actionViewedId.value))

function viewAction(action: Action) {
  actionViewedId.value = action._id
  detailModal.value?.open()
}

// "Use" the currently-viewed action. If it has a PF2e-toolbelt actionable
// macro attached, that macro runs server-side with full toolbelt scope
// (actor, item, token, targets, use, cancel) — same contract as toolbelt's
// own useAction(). For actions without an actionable macro, this is a no-op
// for now; future work will route through PF2e's native action.use().
function useViewedAction() {
  return actionViewed.value?.doMacro?.()
}
</script>

<template>
  <div data-component="ActionsList">
    <div class="break-inside-avoid-column pt-4 pb-8">
      <SheetSection
        :section="group.type"
        :title="$t(group.titleKey)"
        class="pt-4 [&:not(:has(li))]:hidden"
        v-for="group in actionTypes"
        :key="group.type"
      >
        <ul>
          <li
            v-for="action in actions?.filter((a: Action) => a.actionType === group.type)"
            :key="action._id"
          >
            <ViewableItem scale="firm" class="inline-block" @click="viewAction(action)">
              {{ action.name }}
              <ActionIcons
                class="relative -mt-2 pl-1 text-2xl leading-4"
                :actions="
                  group.type === 'reaction'
                    ? 'r'
                    : group.type === 'free'
                      ? 'f'
                      : (action?.system?.actions?.value?.toString() ?? '')
                "
              />
            </ViewableItem>
          </li>
        </ul>
      </SheetSection>
    </div>
    <DetailInfoModal ref="detailModal" :item="actionViewed" :labels="rollOptionLabels">
      <template #actionButtons v-if="isListening">
        <div class="align-items-center flex gap-2">
          <Button
            color="blue"
            class="capitalize"
            v-if="actionViewed?.macroId"
            :clicked="useViewedAction"
          >
            {{ $t('actions.use') }}
          </Button>
        </div>
      </template>
    </DetailInfoModal>
  </div>
</template>
