<script setup lang="ts">
import StatBox from './widgets/StatBox.vue'
import { useInjectedCharacter } from '@/composables/injectKeys'

const { ac } = useInjectedCharacter()
const { current, modifiers } = ac
</script>
<template>
  <StatBox :heading="$t('ac.heading')" :modifiers="modifiers">
    <div>{{ current ?? '??' }}</div>
  </StatBox>
</template>
