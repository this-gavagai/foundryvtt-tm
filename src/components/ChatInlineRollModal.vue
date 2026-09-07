<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ActiveRoll } from '@/types/api-types'
import { useRollsFromActiveRoll } from '@/composables/useRollsFromActiveRoll'
import { useModifierOverrides } from '@/composables/useModifierOverrides'
import { useInjectedActor } from '@/composables/injectKeys'
import InfoModal from '@/components/InfoModal.vue'
import ModifierOverrideList from '@/components/ModifierOverrideList.vue'

const activeRoll = ref<ActiveRoll>()
const rollTitle = ref('')
const modal = ref<InstanceType<typeof InfoModal>>()

const { skills, saves, perception } = useInjectedActor()

type SaveSlug = 'fortitude' | 'will' | 'reflex'
const SAVE_SLUGS: readonly string[] = ['fortitude', 'will', 'reflex']

// The statistic this inline anchor rolls, resolved once. Both the breakdown and
// the button's total come off it, so they cannot describe different statistics.
const rollStatistic = computed(() => {
  const ar = activeRoll.value
  if (!ar) return undefined

  if (ar.action === 'action' && ar.statisticSlug) {
    return skills.value?.find((s) => s.slug === ar.statisticSlug)
  }

  if (ar.action === 'check' && ar.slug) {
    const slug = ar.slug
    if (SAVE_SLUGS.includes(slug)) return saves[slug as SaveSlug].value
    if (slug === 'perception') return perception.value
    return skills.value?.find((s) => s.slug === slug)
  }

  return undefined
})

const rollModifiers = computed(() => rollStatistic.value?.modifiers)

const modifiersToggleable = computed(() => {
  const ar = activeRoll.value
  if (!ar) return false
  if (ar.action === 'action') return true
  if (ar.action === 'check') return !ar.against && ar.slug !== 'spell-attack'
  return false
})

const modifierControls = useModifierOverrides(rollModifiers)
const { modifierOverrides, overrideDelta } = modifierControls

// PF2e's own total for the statistic, moved by whatever the player toggled. The
// button label quotes it so a toggle in this panel has a visible effect, the
// same way the stat box and the strike panel do.
const rollTotal = computed<number | undefined>(() => {
  const total = rollStatistic.value?.totalModifier
  return total === undefined ? undefined : total + overrideDelta.value
})

const rolls = useRollsFromActiveRoll(activeRoll, modifierOverrides, rollTotal)
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
          :controls="modifierControls"
          :toggleable="modifiersToggleable"
        />
      </template>
    </InfoModal>
  </div>
</template>
