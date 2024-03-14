<script setup lang="ts">
import { ref } from 'vue'
import Modal from '@/components/Modal.vue'
import { PlusCircleIcon, MinusCircleIcon } from '@heroicons/vue/24/outline'

const props = defineProps<{ value: number; max?: number; editable?: boolean; title?: string }>()
const counterModal = ref()
const emit = defineEmits<{
  (e: 'changeCount', change: number): void
}>()

function changeCount(change: number) {
  const newTotal = props.value + change
  if (newTotal < 0 || newTotal > (props?.max ?? 1000)) return
  emit('changeCount', newTotal)
}
function click() {
  if (props.editable) counterModal.value.open()
}
defineExpose({ click })
</script>
<template>
  <div @click="click" class="cursor-pointer">
    <span>
      <span v-for="i in Number(props.value ?? 0)">●</span>
      <span v-if="props.max" v-for="i in Number(props.max - props.value)">○</span>
    </span>
    <Teleport to="#modals">
      <Modal ref="counterModal" :title="props.title">
        <div class="w-full py-8 text-3xl flex justify-between">
          <button
            :disabled="props.value < 1"
            class="text-gray-500 disabled:invisible"
            @click="changeCount(-1)"
          >
            <MinusCircleIcon class="h-8 w-8 mr-4" />
          </button>
          <div>
            <span v-for="i in Number(props.value ?? 0)">●</span>
            <span v-if="props.max" v-for="i in Number(props.max - props.value)">○</span>
          </div>
          <button
            :disabled="props.value >= (props.max ?? 1000)"
            class="text-gray-500 disabled:invisible"
            @click="changeCount(+1)"
          >
            <PlusCircleIcon class="h-8 w-8 ml-4" />
          </button>
        </div>
      </Modal>
    </Teleport>
  </div>
</template>
