<script setup lang="ts">
import type { Action } from '@/composables/character'
import { actionTypes } from '@/utils/constants'
import { inject, ref, computed } from 'vue'
import { useKeys } from '@/composables/injectKeys'
import { useListeners } from '@/composables/listenersOnline'

import ActionIcons from '@/components/widgets/ActionIcons.vue'
import Button from './widgets/ButtonWidget.vue'

import InfoModal from '@/components/InfoModal.vue'
import ParsedDescription from './ParsedDescription.vue'

const infoModal = ref()
const description = ref()

const character = inject(useKeys().characterKey)!
const { actions } = character

const { isListening } = useListeners()

const actionViewedId = ref<string | undefined>()
const actionViewed = computed(() => actions.value?.find((a) => a._id === actionViewedId.value))
</script>

<template>
  <div>
    <div class="break-inside-avoid-column px-6 py-4">
      <div class="pb-4 [&:not(:has(li))]:hidden" v-for="group in actionTypes" :key="group.type">
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
        :itemId="actionViewed?._id"
        :traits="actionViewed?.system?.traits?.value"
        :activeRoll="description?.activeRoll"
      >
        <div>{{ description?.activeRoll }}</div>
        <!-- :diceRequest="description?.activeRoll?.slug ? ['d20'] : []"
        @diceResult="
          (face) => {
            doCharacterAction(
              description?.activeRoll?.slug,
              description?.activeRoll?.params,
              face
            ).then((r) => {
              infoModal.rollResultModal.open(r)
              infoModal.close()
            })
          }
        " -->
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
          <ParsedDescription ref="description" :text="actionViewed?.system?.description.value" />
        </template>
        <template #actionButtons v-if="isListening">
          <div class="align-items-center flex gap-2">
            <!-- <Button
              color="blue"
              class="capitalize"
              v-if="description?.activeRoll?.slug"
              :clicked="
                () => {
                  doCharacterAction(
                    description?.activeRoll?.slug,
                    description?.activeRoll?.params
                  ).then((r) => {
                    infoModal.rollResultModal.open(r)
                    infoModal.close()
                  })
                }
              "
              >Roll {{ description?.activeRoll?.label }}</Button
            > -->
            <Button
              color="blue"
              class="apitalize"
              v-if="actionViewed?.macroId"
              :clicked="
                () => {
                  actionViewed?.doMacro?.()
                }
              "
            >
              Run Macro
            </Button>
          </div>
        </template>
      </InfoModal>
    </Teleport>
  </div>
</template>
