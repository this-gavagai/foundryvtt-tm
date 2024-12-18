<script setup lang="ts">
import { ref } from 'vue'
import { TabPanel } from '@headlessui/vue'

const scrollbox = ref()
const props = defineProps<{ goLeft: boolean }>()
function scrollToTop() {
  scrollbox.value.scrollTop = 0
}
</script>
<template>
  <TabPanel
    tabindex="-1"
    v-slot="{ selected }"
    :unmount="false"
    :static="true"
    class="overflow-hidden"
  >
    <Transition
      mode="out-in"
      enter-active-class="duration-200 linear transform overflow-hidden"
      :enter-from-class="
        'transform opacity-0 ' + (props.goLeft ? '-translate-x-8' : 'translate-x-8')
      "
      enter-to-class="opacity-100"
      leave-active-class="duration-200 linear transform overflow-hidden"
      leave-from-class="opacity-100"
      :leave-to-class="'transform opacity-0 ' + (props.goLeft ? 'translate-x-8' : '-translate-x-8')"
      @enter="scrollToTop"
    >
      <div
        ref="scrollbox"
        v-show="selected"
        class="absolute h-[calc(100%-13.5rem)] w-full overflow-auto md:h-[calc(100%-5.5rem)] md:w-[calc(100%-20rem)]"
      >
        <slot></slot>
      </div>
    </Transition>
  </TabPanel>
</template>
