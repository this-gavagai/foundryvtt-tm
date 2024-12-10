<script setup lang="ts">
// TODO (feature): get action modifiers on the card (somehow?)
// TODO (bug): need to handle battlemedicine popup window
import type { Ref } from 'vue'
import type { Action } from '@/composables/character'
import { actionDefs } from '@/utils/constants'
import { inject, ref, computed } from 'vue'
import { capitalize, removeUUIDs } from '@/utils/utilities'
import { useKeys } from '@/composables/injectKeys'

import ButtonWidget from '@/components/ButtonWidget.vue'
import ActionIcons from '@/components/ActionIcons.vue'

import InfoModal from '@/components/InfoModal.vue'
import SkillSelector from './SkillSelector.vue'

const infoModal = ref()
const skillSelector = ref()

const character = inject(useKeys().characterKey)!
const { actions } = character

const action: Ref<Action | undefined> = computed(() =>
  actions.value?.find((i: Action) => i._id === infoModal?.value?.itemId)
)
</script>

<template>
  <div class="brea-avoid-column px-6 py-4">
    <div
      class="pb-4 [&:not(:has(li))]:hidden"
      v-for="group in [
        { title: 'Actions', type: 'action' },
        { title: 'Reactions', type: 'reaction' },
        { title: 'Free Actions', type: 'free' },
        { title: 'Skill Actions', type: 'skill' }
      ]"
      :key="group.type"
    >
      <h3 class="text-lg underline">{{ group.title }}</h3>
      <ul>
        <li
          v-for="action in actions?.filter((a: Action) => a.actionType === group.type)"
          :key="action._id"
        >
          <a class="cursor-pointer" @click="infoModal.open(action._id)">
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
    <InfoModal ref="infoModal" :imageUrl="action?.img" :traits="action?.system?.traits?.value">
      <template #title>
        {{ action?.name }}
      </template>
      <template #description>
        <span v-if="action?.system?.level?.value">Level {{ action?.system?.level?.value }}</span>
        <span v-if="action?.system?.traits?.rarity" class="text-sm">
          ({{ capitalize(action?.system?.traits?.rarity) }})</span
        >
      </template>
      <template #body>
        <div v-html="removeUUIDs(action?.system?.description.value)"></div>
      </template>
      <template #actionButtons>
        <div class="align-items-center flex gap-2">
          <SkillSelector
            v-if="actionDefs.get(action?.system?.slug ?? '')?.skill === '*'"
            ref="skillSelector"
          />
          <ButtonWidget
            label="Roll"
            color="blue"
            v-if="actionDefs.get(action?.system?.slug ?? '')"
            @click="
              action
                ?.doAction?.(
                  actionDefs.get(action?.system?.slug ?? '')?.skill === '*'
                    ? { statistic: skillSelector?.selected?.slug }
                    : {}
                )
                ?.then((r) => {
                  infoModal.rollResultModal.open(r)
                  infoModal.close()
                })
            "
          />
        </div>
      </template>
    </InfoModal>
  </Teleport>
</template>
