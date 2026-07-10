<script setup lang="ts">
import { nextTick, ref } from 'vue'
import type { Item } from '@/composables/character'
import type { ActiveRoll } from '@/types/api-types'
import { useRollsFromActiveRoll } from '@/composables/useRollsFromActiveRoll'
import { useTraitLabels } from '@/composables/useTraitLabels'
import InfoModal from '@/components/InfoModal.vue'
import ParsedDescription from '@/components/ParsedDescription.vue'

// The standard "view an item's details" bottom sheet shared by the simple
// item lists (actions, feats, ancestry/background/class, familiar abilities):
// image + send-to-chat header, name title, level/rarity line, enriched
// description with selectable inline rolls wired to the modal's roll buttons.
// Slots override the standard parts where a sheet needs more; the richer
// panels (spells, equipment, strikes) have their own detail components and
// use InfoModal directly.
//
// Teleports itself to #modals — callers just render it wherever convenient.

defineProps<{
  item: Item | undefined
  // The character's rollOptionLabels, for localizing @Check/@Action labels.
  labels?: Record<string, string>
}>()

const infoModal = ref<InstanceType<typeof InfoModal>>()
const description = ref<InstanceType<typeof ParsedDescription>>()
const activeRoll = ref<ActiveRoll>()
const inlineRolls = useRollsFromActiveRoll(activeRoll)
const { labelFor: rarityLabel } = useTraitLabels()

function open() {
  // Drop any roll armed from the previously viewed item before the modal
  // paints, then re-arm from the fresh description once it renders.
  activeRoll.value = undefined
  infoModal.value?.open()
  nextTick(() => description.value?.initRolls())
}

function close(ignoreModal = false) {
  infoModal.value?.close(ignoreModal)
}

defineExpose({ open, close })
</script>

<template>
  <Teleport to="#modals">
    <InfoModal
      ref="infoModal"
      :imageUrl="item?.img ?? undefined"
      :itemId="item?._id ?? undefined"
      :traits="item?.system?.traits?.value ?? undefined"
      :rolls="inlineRolls"
    >
      <template #title>
        <slot name="title">{{ item?.name }}</slot>
      </template>
      <template #description>
        <slot name="description">
          <span v-if="item?.system?.level?.value">
            {{ $t('common.level') }} {{ item?.system?.level?.value }}
          </span>
          <span v-if="item?.system?.traits?.rarity" class="text-sm">
            ({{ rarityLabel(item?.system?.traits?.rarity) }})
          </span>
        </slot>
      </template>
      <template #body>
        <ParsedDescription
          ref="description"
          :text="item?.system?.description?.value"
          :labels="labels"
          :itemId="item?._id ?? undefined"
          @update:activeRoll="activeRoll = $event"
        />
        <slot name="bodyExtra"></slot>
      </template>
      <template #actionButtons>
        <slot name="actionButtons"></slot>
      </template>
    </InfoModal>
  </Teleport>
</template>
