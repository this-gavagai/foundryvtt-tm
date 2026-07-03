<script setup lang="ts">
import { computed, inject } from 'vue'
import { actorKey } from '@/composables/injectKeys'
import { formatTraitLabel } from '@/utils/traitLabels'

const props = defineProps<{
  traits?: string[]
  // slug→localized label map; falls back to the injected actor's map when
  // omitted (Foundry localizes trait slugs into the world locale).
  labels?: Record<string, string>
}>()

// Soft inject — TraitList also renders outside a sheet (e.g. compendium
// browser), where no actor is provided.
const actor = inject(actorKey, undefined)

const traitLabels = computed(() => props.labels ?? actor?.traitLabels.value ?? {})

const labelFor = (slug: string) => formatTraitLabel(slug, traitLabels.value)
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
