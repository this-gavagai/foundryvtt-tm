<script setup lang="ts">
import Spinner from '@/components/widgets/SpinnerWidget.vue'
import { getPath } from '@/utils/utilities'
import { useInjectedCharacter } from '@/composables/injectKeys'

const { portraitUrl } = useInjectedCharacter()

defineEmits(['click'])
</script>
<template>
  <div
    class="xs:flex border-divider hidden h-24 w-24 items-center overflow-hidden rounded-full border-2"
    @click="$emit('click')"
  >
    <img v-if="portraitUrl" :src="getPath(portraitUrl)" :alt="$t('app.characterPortrait')" />
    <div v-else class="h-full min-h-24">
      <Spinner class="mr-2 h-full w-full p-4" />
    </div>
  </div>
</template>
