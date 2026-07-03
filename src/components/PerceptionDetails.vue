<script setup lang="ts">
import { formatModifier } from '@/utils/formatters'
import { useInjectedActor } from '@/composables/injectKeys'
import StatBox from './widgets/StatBox.vue'

const { perception } = useInjectedActor()
</script>
<template>
  <StatBox
    :heading="$t('saves.perception')"
    :modalHeading="$t('saves.perceptionFull')"
    :proficiency="perception?.rank"
    :modifiers="perception?.modifiers"
    :rollAction="perception?.roll"
  >
    {{ formatModifier(perception?.totalModifier) }}
  </StatBox>
</template>
