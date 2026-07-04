<script setup lang="ts">
import Spinner from '@/components/widgets/SpinnerWidget.vue'
import { getPath } from '@/utils/utilities'
import { useInjectedActor } from '@/composables/injectKeys'

const { portraitUrl, portraitScaleX, portraitScaleY } = useInjectedActor()

defineEmits(['click'])
</script>
<template>
  <div
    class="xs:flex border-divider -z-1 hidden h-24 w-24 items-center rounded-full transition duration-180 ease-out select-none active:scale-90 active:opacity-50 active:duration-60"
    @click="$emit('click')"
  >
    <img
      v-if="portraitUrl"
      :src="getPath(portraitUrl)"
      :alt="$t('app.characterPortrait')"
      :style="{ '--sx': portraitScaleX, '--sy': portraitScaleY }"
      class="scale-x-(--sx) scale-y-(--sy) pointer-events-none"
    />
    <div v-else class="h-full min-h-24">
      <Spinner class="mr-2 h-full w-full p-4" />
    </div>
  </div>
</template>
