<script setup lang="ts">
import { computed, inject } from 'vue'
import { characterKey, familiarKey } from '@/composables/injectKeys'

const props = defineProps<{
  traits?: string[]
  // slug→localized label map; falls back to the injected character/familiar
  // map when omitted (Foundry localizes trait slugs into the world locale).
  labels?: Record<string, string>
}>()

// Soft injects — TraitList also renders outside a sheet (e.g. compendium
// browser), where no character/familiar is provided.
const character = inject(characterKey, undefined)
const familiar = inject(familiarKey, undefined)

const traitLabels = computed(
  () => props.labels ?? character?.traitLabels.value ?? familiar?.traitLabels.value ?? {}
)

const labelFor = (slug: string) => traitLabels.value[slug] ?? slug
</script>

<template>
  <div v-if="traits?.length" data-component="TraitList" class="flex flex-wrap gap-1 pb-1">
    <span
      v-for="trait in traits"
      :key="trait"
      class="bg-[#5E0000] px-1 text-[0.5rem] text-white uppercase"
    >
      {{ labelFor(trait) }}
    </span>
  </div>
</template>
