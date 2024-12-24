<script setup lang="ts">
import { ref } from 'vue'
import { Switch } from '@headlessui/vue'

const props = defineProps<{
  active: boolean | undefined
  clicked?: () => Promise<unknown> | undefined
}>()
const emit = defineEmits(['changed'])

const waiting = ref(false)
function handleClicked() {
  emit('changed', !props.active)
  if (props.clicked) {
    waiting.value = true
    const response = props.clicked?.()
    Promise.resolve(response).then(() => (waiting.value = false))
  }
}
</script>
<template>
  <div class="flex justify-between gap-1 active:text-gray-500" @click="handleClicked()">
    <slot></slot>
    <Switch
      :modelValue="props.active"
      @update:modelValue="emit('changed', !props.active)"
      :class="[props.active ? 'bg-green-600' : 'bg-gray-500', waiting ? 'opacity-50' : '']"
      class="relative z-auto inline-flex h-[24px] w-[40px] shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-white/75"
    >
      <span class="sr-only">Item Worn in Slot?</span>
      <span
        aria-hidden="true"
        :class="props.active ? 'translate-x-4' : 'translate-x-0'"
        class="pointer-events-none inline-block h-[20px] w-[20px] transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out"
      />
    </Switch>
  </div>
</template>
