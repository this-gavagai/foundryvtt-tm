<script setup lang="ts">
// TODO (feature): get action modifiers on the card (somehow?)
// TODO (feature): need to handle battlemedicine popup window (by providing an alternate macro?)
import type { Action } from '@/composables/character'
import { actionDefs, actionTypes } from '@/utils/constants'
import { inject, ref, computed } from 'vue'
import { removeUUIDs } from '@/utils/utilities'
import { useKeys } from '@/composables/injectKeys'

import ButtonWidget from '@/components/ButtonWidget.vue'
import ActionIcons from '@/components/ActionIcons.vue'

import InfoModal from '@/components/InfoModal.vue'
import SkillSelector from './SkillSelector.vue'

const infoModal = ref()
const skillSelector = ref()

const character = inject(useKeys().characterKey)!
const { actions } = character

const actionViewedId = ref<string | undefined>()
const actionViewed = computed(() => actions.value?.find((a) => a._id === actionViewedId.value))
</script>

<template>
  <div class="break-inside-avoid-column px-6 py-4 [&:not(:has(li))]:hidden">
    <div class="pb-4" v-for="group in actionTypes" :key="group.type">
      <h3 class="text-lg underline">{{ group.title }}</h3>
      <ul>
        <li
          v-for="action in actions?.filter((a: Action) => a.actionType === group.type)"
          :key="action._id"
        >
          <a
            class="cursor-pointer"
            @click="
              () => {
                actionViewedId = action._id
                infoModal.open()
              }
            "
          >
            {{ action.name }}
            <ActionIcons
              class="relative -mt-[.5rem] pl-1 text-2xl leading-4"
              :actions="
                group.type === 'reaction'
                  ? 'r'
                  : group.type === 'free'
                    ? 'f'
                    : action?.system?.actions?.value + ''
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
      :traits="actionViewed?.system?.traits?.value"
    >
      <template #title>
        {{ actionViewed?.name }}
      </template>
      <template #description>
        <span v-if="actionViewed?.system?.level?.value"
          >Level {{ actionViewed?.system?.level?.value }}</span
        >
        <span v-if="actionViewed?.system?.traits?.rarity" class="text-sm capitalize">
          ({{ actionViewed?.system?.traits?.rarity }})</span
        >
      </template>
      <template #body>
        <div v-html="removeUUIDs(actionViewed?.system?.description.value)"></div>
      </template>
      <template #actionButtons>
        <div class="align-items-center flex gap-2">
          <SkillSelector
            v-if="actionDefs.get(actionViewed?.system?.slug ?? '')?.skill === '*'"
            ref="skillSelector"
          />
          <ButtonWidget
            label="Roll"
            color="blue"
            v-if="actionDefs.get(actionViewed?.system?.slug ?? '')"
            :clicked="
              () => {
                return actionViewed
                  ?.doAction?.(
                    actionDefs.get(actionViewed?.system?.slug ?? '')?.skill === '*'
                      ? { statistic: skillSelector?.selected?.slug }
                      : {}
                  )
                  ?.then((r) => {
                    infoModal.rollResultModal.open(r)
                    infoModal.close()
                  })
              }
            "
          />
        </div>
      </template>
    </InfoModal>
  </Teleport>
</template>
