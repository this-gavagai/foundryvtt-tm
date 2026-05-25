<script setup lang="ts">
import Spinner from '@/components/widgets/SpinnerWidget.vue'
import { getPath } from '@/utils/utilities'
import { useInjectedCharacter } from '@/composables/injectKeys'

const { portraitUrl, portraitScaleX, portraitScaleY } = useInjectedCharacter()

defineEmits(['click'])
</script>
<template>
  <div
    class="xs:flex border-divider -z-1 hidden h-24 w-24 items-center rounded-full"
    @click="$emit('click')"
  >
    <img
      v-if="portraitUrl"
      :src="getPath(portraitUrl)"
      :alt="$t('app.characterPortrait')"
      :style="{ '--sx': portraitScaleX, '--sy': portraitScaleY }"
      class="scale-x-(--sx) scale-y-(--sy)"
    />
    <div v-else class="h-full min-h-24">
      <Spinner class="mr-2 h-full w-full p-4" />
    </div>
  </div>
</template>
