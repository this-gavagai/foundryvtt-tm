<script setup lang="ts">
import { ref } from 'vue'
import { TabPanel } from '@headlessui/vue'
import { useAnimationsReady } from '@/composables/useAnimationsReady'

const scrollbox = ref()
const props = defineProps<{ goLeft: boolean }>()

// Suppress the slide-in on first paint: on a freshly loaded sheet the selected
// panel toggles from hidden to shown, which would otherwise slide in from the
// side. Tab switches during the session still animate.
const animationsReady = useAnimationsReady()
function scrollToTop() {
  scrollbox.value.scrollTo(0, 0)
  scrollbox.value.focus()
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
      enter-active-class="duration-300 linear transform overflow-hidden"
      :enter-from-class="
        animationsReady
          ? 'transform opacity-0 ' + (props.goLeft ? '-translate-x-8' : 'translate-x-8')
          : ''
      "
      enter-to-class="opacity-100"
      leave-active-class="duration-300 linear transform overflow-hidden"
      leave-from-class="opacity-100"
      :leave-to-class="'transform opacity-0 ' + (props.goLeft ? 'translate-x-8' : '-translate-x-8')"
      @enter="scrollToTop"
    >
      <div
        ref="scrollbox"
        v-show="selected"
        class="scrollbar-none absolute h-[calc(100%-13.5rem)] w-full overflow-auto overscroll-contain md:h-[calc(100%-5.5rem)] md:w-[calc(100%-20rem)]"
        style="scrollbar-width: none"
      >
        <!-- For a while, I was forcing this to 100.1%, but I don't know why. It created scroll issues so I removed it. -->
        <div class="min-h-full">
          <slot></slot>
        </div>
      </div>
    </Transition>
  </TabPanel>
</template>
