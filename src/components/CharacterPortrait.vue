<script setup lang="ts">
import Spinner from '@/components/widgets/SpinnerWidget.vue'
import TokenArt from '@/components/TokenArt.vue'
import { useInjectedActor } from '@/composables/injectKeys'

const { portraitUrl, portraitScaleX, portraitScaleY, portraitRing } = useInjectedActor()

defineEmits(['click'])
</script>
<template>
  <div
    class="xs:flex border-divider -z-1 hidden h-24 w-24 items-center overflow-visible rounded-full transition duration-180 ease-out select-none active:scale-90 active:opacity-50 active:duration-60"
    @click="$emit('click')"
  >
    <TokenArt
      v-if="portraitUrl"
      :url="portraitUrl"
      :scaleX="portraitScaleX"
      :scaleY="portraitScaleY"
      :ring="portraitRing"
      :px="96"
      :alt="$t('app.characterPortrait')"
    />
    <div v-else class="h-full min-h-24">
      <Spinner class="mr-2 h-full w-full p-4" />
    </div>
  </div>
</template>
