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

const { skills, saves, perception } = useInjectedCharacter()

type SaveSlug = 'fortitude' | 'will' | 'reflex'
const SAVE_SLUGS: readonly string[] = ['fortitude', 'will', 'reflex']

const rollModifiers = computed(() => {
  const ar = activeRoll.value
  if (!ar) return undefined

  if (ar.action === 'action' && ar.statisticSlug) {
    return skills.value?.find((s) => s.slug === ar.statisticSlug)?.modifiers
  }

  if (ar.action === 'check' && ar.slug) {
    const slug = ar.slug
    if (SAVE_SLUGS.includes(slug)) return saves[slug as SaveSlug].value?.modifiers
    if (slug === 'perception') return perception.value?.modifiers
    return skills.value?.find((s) => s.slug === slug)?.modifiers
  }

  return undefined
})

const modifiersToggleable = computed(() => {
  const ar = activeRoll.value
  if (!ar) return false
  if (ar.action === 'action') return true
  if (ar.action === 'check') return !ar.against && ar.slug !== 'spell-attack'
  return false
})

const {
  modifierOverrides,
  toggleModifier,
  effectiveEnabled,
  isManuallyActivated,
  isManuallyDeactivated,
  isStackingLoser
} = useModifierOverrides(rollModifiers)

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
          v-if="rollModifiers?.length"
          :modifiers="rollModifiers"
          :toggleable="modifiersToggleable"
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
