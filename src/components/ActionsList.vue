<script setup lang="ts">
import type { Action } from '@/composables/character'
import type { ActiveRoll } from '@/types/api-types'
import { actionTypes } from '@/utils/constants'
import { nextTick, ref, computed } from 'vue'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { storeToRefs } from 'pinia'
import { useListenersStore } from '@/stores/listenersOnline'
import { useRollsFromActiveRoll } from '@/composables/useRollsFromActiveRoll'

import ActionIcons from '@/components/widgets/ActionIcons.vue'
import ViewableItem from '@/components/widgets/ViewableItem.vue'
import SheetSection from '@/components/widgets/SheetSection.vue'
import Button from './widgets/ButtonWidget.vue'

import InfoModal from '@/components/InfoModal.vue'
import ParsedDescription from './ParsedDescription.vue'

const infoModal = ref()
const description = ref<InstanceType<typeof ParsedDescription>>()
const activeRoll = ref<ActiveRoll>()
const inlineRolls = useRollsFromActiveRoll(activeRoll)

const character = useInjectedCharacter()
const { actions, rollOptionLabels } = character

const { isListening } = storeToRefs(useListenersStore())

const actionViewedId = ref<string | undefined>()
const actionViewed = computed(() => actions.value?.find((a) => a._id === actionViewedId.value))

function viewAction(action: Action) {
  activeRoll.value = undefined
  actionViewedId.value = action._id
  infoModal.value.open()
  nextTick(() => description.value?.initRolls())
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
    <Teleport to="#modals">
      <InfoModal
        ref="infoModal"
        :imageUrl="actionViewed?.img"
        :itemId="actionViewed?._id"
        :traits="actionViewed?.system?.traits?.value"
        :rolls="inlineRolls"
      >
        <template #title>
          {{ actionViewed?.name }}
        </template>
        <template #description>
          <span v-if="actionViewed?.system?.level?.value"
            >{{ $t('common.level') }} {{ actionViewed?.system?.level?.value }}</span
          >
          <span v-if="actionViewed?.system?.traits?.rarity" class="text-sm capitalize">
            ({{ actionViewed?.system?.traits?.rarity }})</span
          >
        </template>
        <template #body>
          <ParsedDescription
            ref="description"
            :text="actionViewed?.system?.description.value"
            :labels="rollOptionLabels"
            :itemId="actionViewed?._id ?? undefined"
            @update:activeRoll="activeRoll = $event"
          />
        </template>
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
      </InfoModal>
    </Teleport>
  </div>
</template>
