<script setup lang="ts">
import type { Action } from '@/composables/character'
import type { ActiveRoll } from '@/types/api-types'
import { computed, nextTick, ref } from 'vue'
import { useInjectedFamiliar } from '@/composables/injectKeys'
import { useRollsFromActiveRoll } from '@/composables/useRollsFromActiveRoll'

import ActionIcons from '@/components/widgets/ActionIcons.vue'
import InfoModal from '@/components/InfoModal.vue'
import ParsedDescription from '@/components/ParsedDescription.vue'

const familiar = useInjectedFamiliar()
const { actions, rollOptionLabels } = familiar

const infoModal = ref()
const description = ref<InstanceType<typeof ParsedDescription>>()
const activeRoll = ref<ActiveRoll>()
const inlineRolls = useRollsFromActiveRoll(activeRoll)

const actionViewedId = ref<string | undefined>()
const actionViewed = computed(() => actions.value?.find((a) => a._id === actionViewedId.value))

function viewAction(action: Action) {
  activeRoll.value = undefined
  actionViewedId.value = action._id
  infoModal.value.open()
  nextTick(() => description.value?.initRolls())
}
</script>
<template>
  <div data-component="FamiliarActionsList" class="px-6 py-4">
    <div data-section="abilities" class="[&:not(:has(li))]:hidden">
      <h3 class="mb-1 text-lg underline">Abilities</h3>
      <ul class="space-y-1">
        <li v-for="action in actions" :key="action._id">
          <a class="cursor-pointer" @click="viewAction(action)">
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
          </a>
        </li>
      </ul>
    </div>
    <div v-if="actions?.length === 0" class="py-8 text-center text-sm text-gray-500">
      No familiar abilities.
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
          <span v-if="actionViewed?.actionType === 'passive'">Passive</span>
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
      </InfoModal>
    </Teleport>
  </div>
</template>
