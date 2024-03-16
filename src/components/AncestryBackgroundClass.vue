<script setup lang="ts">
import { inject, computed, watch, ref } from 'vue'
const actor: any = inject('actor')
</script>
<template>
  <div>
    <div class="text-md whitespace-nowrap overflow-hidden">
      <span>{{ actor.items?.find((x: any) => x.type === 'ancestry')?.name ?? '-' }}&nbsp;</span>
      <span>{{ actor.items?.find((x: any) => x.type === 'background')?.name }}</span>
    </div>
    <div class="text-md whitespace-nowrap overflow-hidden"></div>
    <div class="text-md whitespace-nowrap overflow-hidden">
      <span>{{ actor.items?.find((x: any) => x.type === 'class')?.name ?? '-' }}</span>
      <span v-if="actor.system?.details.level.value">{{
        ` (Level ${actor.system?.details.level.value})`
      }}</span>
    </div>
  </div>
</template>
