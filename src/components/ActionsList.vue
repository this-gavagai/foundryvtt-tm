<script setup lang="ts">
import type { Action } from '@/composables/character'
import { actionTypes } from '@/utils/constants'
import { ref, computed } from 'vue'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { storeToRefs } from 'pinia'
import { useListenersStore } from '@/stores/listenersOnline'

import ActionIcons from '@/components/widgets/ActionIcons.vue'
import UsesWidget from '@/components/widgets/UsesWidget.vue'
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

// "Use" the currently-viewed action, exactly as PF2e's own actions tab does:
// spend one of its Frequency uses and post its card. If the action has a
// PF2e-toolbelt actionable macro attached, that macro runs server-side instead
// with full toolbelt scope (actor, item, token, targets, use, cancel) — same
// contract as toolbelt's own useAction() — since attaching a macro is how a
// table replaces an action's default behavior. See `doUse` in characterActions.
function useViewedAction() {
  return actionViewed.value?.doUse?.()
}
</script>

<template>
  <div data-component="ActionsList">
    <div class="break-inside-avoid-column">
      <SheetSection
        :section="group.type"
        :title="$t(group.titleKey)"
        class="pt-4 [&:not(:has(li))]:hidden"
        v-for="group in actionTypes"
        :key="group.type"
      >
        <ul>
          <!-- Row splits name-left / uses-right: the frequency indicators line
               up in a column of their own, so "what do I still have?" is one
               glance down the edge rather than a hunt through the names.
               `items-baseline` sits the indicator on the name's first line, so
               a name that wraps doesn't drag it down the row. -->
          <li
            v-for="action in actions?.filter((a: Action) => a.actionType === group.type)"
            :key="action._id"
            class="flex items-baseline justify-between gap-2"
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
            <!-- Limited-use actions (Rage, a 1/day feat activation) are worth
                 nothing if the sheet can't say whether they're still available,
                 so the count rides on the row rather than hiding in the modal. -->
            <UsesWidget
              class="shrink-0 text-gray-600"
              :value="action.system?.frequency?.value"
              :max="action.system?.frequency?.max"
              :per="action.system?.frequency?.perLabel"
            />
          </li>
        </ul>
      </SheetSection>
    </div>
    <DetailInfoModal
      ref="detailModal"
      :item="actionViewed"
      :labels="rollOptionLabels"
      :uses="actionViewed?.system?.frequency"
      :setUses="actionViewed?.setUses"
    >
      <template #actionButtons v-if="isListening">
        <div class="align-items-center flex gap-2">
          <!-- Shown on the same footing as PF2e's own sheet: any action it
               considers usable (see `usable` in defs/action). Deliberately NOT
               disabled at zero uses remaining — PF2e leaves its button live
               too, because spending past a Frequency is a table call (a rule
               element, a GM's ruling), not the sheet's to refuse. -->
          <Button
            color="blue"
            class="capitalize"
            v-if="actionViewed?.usable"
            :clicked="useViewedAction"
          >
            {{ $t('actions.use') }}
          </Button>
        </div>
      </template>
    </DetailInfoModal>
  </div>
</template>
