<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ActiveRoll } from '@/types/api-types'
import { useRollsFromActiveRoll } from '@/composables/useRollsFromActiveRoll'
import { useModifierOverrides } from '@/composables/useModifierOverrides'
import { useInjectedCharacter } from '@/composables/injectKeys'
import InfoModal from '@/components/InfoModal.vue'
import ModifierOverrideList from '@/components/ModifierOverrideList.vue'

const activeRoll = ref<ActiveRoll>()
const rollTitle = ref('')
const modal = ref<InstanceType<typeof InfoModal>>()

const { skills } = useInjectedCharacter()

const actionModifiers = computed(() => {
  if (activeRoll.value?.action !== 'action' || !activeRoll.value.statisticSlug) return undefined
  return skills.value?.find((s) => s.slug === activeRoll.value!.statisticSlug)?.modifiers
})

const {
  modifierOverrides,
  toggleModifier,
  effectiveEnabled,
  isManuallyActivated,
  isManuallyDeactivated,
  isStackingLoser
} = useModifierOverrides(actionModifiers)

const rolls = useRollsFromActiveRoll(activeRoll, modifierOverrides)
const isOpen = computed(() => modal.value?.isOpen ?? false)

function open(roll: ActiveRoll) {
  activeRoll.value = roll
  modifierOverrides.value = {}
  rollTitle.value = roll.label ?? roll.formula ?? roll.slug ?? ''
  modal.value?.open()
}

function close() {
  modal.value?.close()
}

defineExpose({ open, close, isOpen })
</script>

<template>
  <div data-component="ChatInlineRollModalRoot">
    <InfoModal ref="modal" :rolls="rolls" @closing="modifierOverrides = {}">
      <template #title>
        {{ rollTitle || $t('common.roll') }}
      </template>
      <template #description>
        <div v-if="activeRoll?.formula" class="mt-1 text-sm text-gray-500">
          {{ activeRoll.formula }}
        </div>
        <ModifierOverrideList
          v-if="actionModifiers?.length"
          :modifiers="actionModifiers"
          :toggleable="true"
          :effectiveEnabled="effectiveEnabled"
          :isManuallyActivated="isManuallyActivated"
          :isManuallyDeactivated="isManuallyDeactivated"
          :isStackingLoser="isStackingLoser"
          :onToggle="toggleModifier"
        />
      </template>
    </InfoModal>
  </div>
</template>
