<script setup lang="ts">
import { formatModifier } from '@/utils/utilities'
import { useInjectedCharacter } from '@/composables/injectKeys'
import StatBox from './widgets/StatBox.vue'

const { perception } = useInjectedCharacter()
</script>
<template>
  <StatBox
    :heading="$t('saves.perception')"
    :proficiency="perception?.rank"
    :modifiers="perception?.modifiers"
    :rollAction="perception?.roll"
  >
    {{ formatModifier(perception?.totalModifier) }}
  </StatBox>
</template>
