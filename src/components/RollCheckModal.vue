<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { freeRoll } from '@/api/actions'
import InfoModal from '@/components/InfoModal.vue'
import Toggle from '@/components/widgets/ToggleWidget.vue'
import type { Roll } from '@/types/roll-types'

const { t } = useI18n()
const { _id: characterId, skills, perception } = useInjectedCharacter()

const modalRef = ref()
const isSecret = ref(false)

// Single-select. When set, the d20 routes through that stat's check.roll so the
// character's modifier (and any rule-element bonuses keyed on the stat's
// domains) actually apply. When undefined: raw d20 via freeRoll.
const activeStat = ref<string | undefined>(undefined)
function toggleStat(slug: string) {
  activeStat.value = activeStat.value === slug ? undefined : slug
}

const baseSkills = computed(() => (skills.value ?? []).filter((s) => !s.lore))
const loreSkills = computed(() => (skills.value ?? []).filter((s) => s.lore))

function findStat(slug: string | undefined) {
  if (!slug) return undefined
  if (slug === perception.value?.slug) return perception.value
  return skills.value?.find((s) => s.slug === slug)
}

const activeLabel = computed(() => findStat(activeStat.value)?.label ?? '')

const checkRolls = computed<Roll[]>(() => [
  {
    key: 'roll-check',
    label: activeLabel.value
      ? `${t('common.roll')} ${activeLabel.value}`
      : t('sideMenu.rollD20'),
    color: 'blue',
    dice: ['d20'],
    armed: true,
    execute: async (faces?: number[]) => {
      const stat = findStat(activeStat.value)
      const options = isSecret.value ? { rollMode: 'blindroll' } : {}
      const result = stat?.roll
        ? await stat.roll(faces?.[0], options)
        : await freeRoll(characterId.value ?? '', isSecret.value, faces?.[0])
      // Reset selection after the roll fires so the next open starts fresh.
      activeStat.value = undefined
      return result
    }
  }
])

function open() {
  modalRef.value?.open()
}
function close() {
  modalRef.value?.close()
}

// Drop the active selection if the character switches under us and that slug
// no longer exists.
watch(skills, () => {
  if (activeStat.value && !findStat(activeStat.value)) activeStat.value = undefined
})

defineExpose({ open, close })
</script>
<template>
  <InfoModal ref="modalRef" :rolls="checkRolls">
    <template #title>{{ $t('sideMenu.freeRollTitle') }}</template>
    <template #beforeBody>
      <div data-component="RollCheckBuilder">
        <div class="mt-2">
          <Toggle :active="isSecret" @changed="(v: boolean) => (isSecret = v)">
            <span class="text-lg">{{ $t('sideMenu.secret') }}</span>
          </Toggle>
        </div>

        <div class="mt-4">
          <h4 class="text-xs tracking-wide text-gray-600 uppercase">
            {{ $t('sideMenu.checkStat') }}
          </h4>
          <div data-part="check-traits" class="mt-1 flex flex-wrap gap-1">
            <span
              v-if="perception"
              :data-active="activeStat === perception.slug ? '' : undefined"
              class="inline-block cursor-pointer rounded border border-gray-400 bg-gray-100 px-2 py-1 text-xs whitespace-nowrap text-gray-900 select-none active:bg-gray-300 data-active:border-blue-700 data-active:bg-blue-600 data-active:text-white"
              @click="toggleStat(perception.slug ?? '')"
            >
              {{ perception.label }}
            </span>
            <span
              v-for="s in baseSkills"
              :key="s.slug"
              :data-active="activeStat === s.slug ? '' : undefined"
              class="inline-block cursor-pointer rounded border border-gray-400 bg-gray-100 px-2 py-1 text-xs whitespace-nowrap text-gray-900 select-none active:bg-gray-300 data-active:border-blue-700 data-active:bg-blue-600 data-active:text-white"
              @click="toggleStat(s.slug ?? '')"
            >
              {{ s.label }}
            </span>
            <span
              v-for="s in loreSkills"
              :key="s.slug"
              :data-active="activeStat === s.slug ? '' : undefined"
              class="inline-block cursor-pointer rounded border border-gray-400 bg-gray-100 px-2 py-1 text-xs whitespace-nowrap text-gray-900 italic select-none active:bg-gray-300 data-active:border-blue-700 data-active:bg-blue-600 data-active:text-white"
              @click="toggleStat(s.slug ?? '')"
            >
              {{ s.label }}
            </span>
          </div>
        </div>
      </div>
    </template>
  </InfoModal>
</template>
