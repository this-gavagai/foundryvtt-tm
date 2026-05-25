<script setup lang="ts">
import { formatModifier } from '@/utils/utilities'
import { useInjectedCharacter } from '@/composables/injectKeys'
import StatBox from './widgets/StatBox.vue'

const { perception } = useInjectedCharacter()
</script>
<template>
  <StatBox
    :heading="$t('saves.perception')"
    :modalHeading="$t('saves.perceptionFull')"
    :proficiency="perception?.rank"
    :modifiers="perception?.modifiers"
    :rollAction="perception?.roll"
    class="pl-2"
  >
    {{ formatModifier(perception?.totalModifier) }}
  </StatBox>
</template>
