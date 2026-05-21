<script setup lang="ts">

import { useInjectedCharacter } from '@/composables/injectKeys'
import { startCase } from 'lodash-es'

import Toggle from './widgets/ToggleWidget.vue'
import Dropdown from './widgets/DropdownWidget.vue'

const character = useInjectedCharacter()
const { rollOptions } = character
</script>
<template>
  <div class="[&:not(:has(li))]:hidden">
    <h3 class="pb-2 text-lg italic">{{ $t('rollOptions.heading') }}</h3>
    <div class="pb-4 text-red-500">
      {{ $t('rollOptions.experimentalWarning') }}
    </div>
    <ul v-if="rollOptions" class="empty:hidden">
      <li
        v-for="[key, rollOption] in [...rollOptions].filter(
          ([k, r]) => (r.toggleable && !r.alwaysActive) || r.suboptions.length > 1
        )"
        :key="key"
        class="pb-2"
      >
        <div class="flex justify-between">
          <div
            v-if="
              (rollOption.toggleable && !rollOption.alwaysActive) ||
              rollOption.suboptions.length > 1
            "
            class="font-bold"
          >
            <span>
              {{ rollOption.label ?? startCase(key) }}
            </span>
            <span v-if="rollOption.suboptions.length === 1">
              ({{ rollOption.suboptions[0].label ?? startCase(rollOption.suboptions[0].value) }})
            </span>
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
              name: s.label ?? startCase(s.value) ?? ''
            })) ?? []
          "
          :selectedId="
            rollOption.suboptions.find((s) => s.value === rollOption.selection)?.value ?? '0'
          "
          @change="(newId: any) => rollOption.updateRule(null, newId.id)"
        />
      </li>
    </ul>
  </div>
</template>
