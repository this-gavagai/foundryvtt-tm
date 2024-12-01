<script setup lang="ts">
// TODO: (feature) get action modifiers on the card (somehow?)
// TODO: need to handle battlemedicine popup window
import type { Ref } from 'vue'
import type { Action } from '@/composables/character'
import { actionDefs } from '@/utils/constants'
import { inject, ref, computed } from 'vue'
import { capitalize, removeUUIDs, makeActionIcons } from '@/utils/utilities'
import { useKeys } from '@/composables/injectKeys'

import Button from '@/components/ButtonWidget.vue'

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
  <div class="px-6">
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
            <span
              class="relative -mt-[.5rem] pl-1 text-2xl leading-4"
              v-html="
                makeActionIcons(
                  group.type === 'reaction' ? 'r' : action?.system?.actions?.value + ''
                )
              "
            ></span>
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
        Level {{ action?.system?.level?.value ?? 0 }}
        <span class="text-sm">({{ capitalize(action?.system?.traits?.rarity) }})</span>
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
          <Button
            label="Roll"
            v-if="actionDefs.get(action?.system?.slug ?? '')"
            class="bg-blue-600 text-white hover:bg-blue-500"
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
