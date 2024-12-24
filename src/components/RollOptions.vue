<script setup lang="ts">
import { inject } from 'vue'
import { useKeys } from '@/composables/injectKeys'
import { capitalize } from 'lodash-es'

import Toggle from './widgets/ToggleWidget.vue'
import Dropdown from './widgets/DropdownWidget.vue'

const character = inject(useKeys().characterKey)!
const { rollOptions } = character
</script>
<template>
  <h3 class="pb-2 text-lg italic">Character Options</h3>
  <div class="pb-4 text-red-500">
    This RollOption implementation is still very experimential. Backups and caution advised.
  </div>
  <ul v-if="rollOptions">
    <li v-for="[key, rollOption] in rollOptions.entries()" :key="key" class="pb-2">
      <div class="flex justify-between">
        <div
          v-if="
            (rollOption.toggleable && !rollOption.alwaysActive) || rollOption.suboptions.length > 1
          "
          class="font-bold"
        >
          {{ capitalize(key.replace('-', ' ')) }}
        </div>
        <Toggle
          v-if="rollOption.toggleable && !rollOption.alwaysActive"
          :active="rollOption.value"
          :clicked="() => rollOption?.updateRule(rollOption.value ? undefined : true, null)"
        >
        </Toggle>
      </div>

      <Dropdown
        class="pb-4"
        v-if="rollOption.suboptions.length > 1"
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
