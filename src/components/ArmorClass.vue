<script setup lang="ts">
import StatBox from './widgets/StatBox.vue'
import { useInjectedActor } from '@/composables/injectKeys'

const { ac } = useInjectedActor()
const { current, modifiers } = ac
</script>
<template>
  <StatBox :heading="$t('ac.heading')" :modifiers="modifiers">
    <div>{{ current ?? '??' }}</div>
  </StatBox>
</template>
