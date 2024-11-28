<script setup lang="ts">
import { ref } from 'vue'
import Modal from '@/components/ModalBox.vue'
import { PlusCircleIcon, MinusCircleIcon } from '@heroicons/vue/24/outline'
import Button from '@/components/ButtonWidget.vue'
import Spinner from '@/components/SpinnerWidget.vue'

const props = defineProps<{
  value: number
  max?: number
  editable?: boolean
  title?: string
  updating?: boolean
}>()
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
function close() {
  counterModal.value.close()
}

defineExpose({ click, close })
</script>
<template>
  <div @click="click" class="cursor-pointer">
    <span>
      <span v-for="i in Number(props.value ?? 0)" :key="'pip' + i">●</span>
      <span v-for="i in props.max ? Number(props.max - props.value) : 0" :key="'emp' + i">○</span>
    </span>
    <Teleport to="#modals">
      <Modal ref="counterModal" :title="props.title">
        <div class="flex w-full justify-between py-8 text-3xl">
          <Button
            :disabled="updating || props.value < 1"
            class="text-gray-500 disabled:invisible"
            @click="changeCount(-1)"
          >
            <MinusCircleIcon class="mr-4 h-8 w-8" />
          </Button>
          <div class="grid grid-cols-1 grid-rows-1">
            <div
              class="relative row-start-1 row-end-1 py-2 transition-opacity delay-200 ease-in"
              :class="{ 'opacity-0': updating }"
            >
              <span v-for="i in Number(props.value ?? 0)" :key="'pip' + i">●</span>
              <span v-for="i in props.max ? Number(props.max - props.value) : 0" :key="'emp' + i"
                >○</span
              >
            </div>
            <div class="absolute row-start-1 row-end-1 px-7">
              <Spinner
                class="mx-auto h-12 flex-1 py-2 transition-opacity delay-200 ease-out"
                :class="{ 'opacity-0': !updating }"
              />
            </div>
          </div>
          <Button
            :disabled="updating || (props.max && props.value >= props.max)"
            class="text-gray-500 disabled:invisible"
            @click="changeCount(+1)"
          >
            <PlusCircleIcon class="ml-4 h-8 w-8" />
          </Button>
        </div>
      </Modal>
    </Teleport>
  </div>
</template>
