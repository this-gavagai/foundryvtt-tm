<script setup lang="ts">
import { inject } from 'vue'
import { useKeys } from '@/composables/injectKeys'
import { capitalize } from 'lodash-es'

import Toggle from './ToggleWidget.vue'
import Dropdown from './DropdownWidget.vue'

const character = inject(useKeys().characterKey)!
const { rollOptions } = character
</script>
<template>
  <h3 class="pb-2 text-lg italic">Character Options</h3>
  <ul v-if="rollOptions">
    <li v-for="[key, rollOption] in rollOptions.entries()" :key="key" class="pb-2">
      <Toggle
        :active="rollOption.value"
        :clicked="() => rollOption?.updateRule(rollOption.value ? undefined : true, null)"
      >
        <div>{{ capitalize(key.replace('-', ' ')) }}</div>
      </Toggle>
      <Dropdown
        class="pb-4"
        v-if="rollOption.suboptions.length > 0"
        :list="
          rollOption.suboptions.map((s) => ({
            id: s.value ?? '',
            name: capitalize(s.value?.replace('-', ' ')) ?? ''
          })) ?? []
        "
        :selectedId="
          rollOption.suboptions.find((s) => s.value === rollOption.selection)?.value ?? '0'
        "
        @change="(newId: any) => rollOption.updateRule(null, newId.id)"
      />
    </li>
  </ul>
</template>
