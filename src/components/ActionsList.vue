<script setup lang="ts">
import type { Action } from '@/composables/character'
import { actionTypes } from '@/utils/constants'
import { ref, computed } from 'vue'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { storeToRefs } from 'pinia'
import { useListenersStore } from '@/stores/listenersOnline'

import ActionIcons from '@/components/widgets/ActionIcons.vue'
import Button from './widgets/ButtonWidget.vue'

import InfoModal from '@/components/InfoModal.vue'
import ParsedDescription from './ParsedDescription.vue'

const infoModal = ref()
const description = ref()

const character = useInjectedCharacter()
const { actions, rollOptionLabels } = character

const { isListening } = storeToRefs(useListenersStore())

const actionViewedId = ref<string | undefined>()
const actionViewed = computed(() => actions.value?.find((a) => a._id === actionViewedId.value))

function viewAction(action: Action) {
  actionViewedId.value = action._id
  infoModal.value.open()
}

function runViewedActionMacro() {
  actionViewed.value?.doMacro?.()
}
</script>

<template>
  <div data-component="ActionsList">
    <div class="break-inside-avoid-column py-4">
      <div :data-section="group.type" class="pb-4 [&:not(:has(li))]:hidden" v-for="group in actionTypes" :key="group.type">
        <h3 class="text-lg underline">{{ $t(group.titleKey) }}</h3>
        <ul>
          <li
            v-for="action in actions?.filter((a: Action) => a.actionType === group.type)"
            :key="action._id"
          >
            <a class="cursor-pointer" @click="viewAction(action)">
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
            </a>
          </li>
        </ul>
      </div>
    </div>
    <Teleport to="#modals">
      <InfoModal
        ref="infoModal"
        :imageUrl="actionViewed?.img"
        :itemId="actionViewed?._id"
        :traits="actionViewed?.system?.traits?.value"
        :activeRoll="description?.activeRoll"
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
          <ParsedDescription ref="description" :text="actionViewed?.system?.description.value" :labels="rollOptionLabels" />
        </template>
        <template #actionButtons v-if="isListening">
          <div class="align-items-center flex gap-2">
            <Button
              color="blue"
              class="capitalize"
              v-if="actionViewed?.macroId"
              :clicked="runViewedActionMacro"
            >
              {{ $t('actions.runMacro') }}
            </Button>
          </div>
        </template>
      </InfoModal>
    </Teleport>
  </div>
</template>
