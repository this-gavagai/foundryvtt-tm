<script setup lang="ts">
import { computed, ref } from 'vue'
import Modal from './ModalBox.vue'
import { dieIcons } from '@/utils/chatRollDisplay'
import type { RequestResolutionArgs } from '@/types/api-types'

const modal = ref<InstanceType<typeof Modal>>()
const result = ref<RequestResolutionArgs | null | undefined>()
const roll = computed(() => result.value?.roll)

interface DisplayDieResult {
  result: number
}

interface DisplayDie {
  faces: number
  results: DisplayDieResult[]
}

const rollDice = computed(() => (roll.value?.dice ?? []) as unknown as DisplayDie[])

function dieIconForFaces(faces: number) {
  return dieIcons[faces]
}

const singleD20Result = computed(() => {
  if (roll.value?.isSecret) return null
  const d20Results = rollDice.value.filter((die) => die.faces === 20).flatMap((die) => die.results)
  return d20Results.length === 1 ? d20Results[0] : null
})

function d20ResultClass(dieResult: DisplayDieResult) {
  if (dieResult !== singleD20Result.value) return null
  if (dieResult.result === 20)
    return 'inline-block animate-nat-twenty text-green-700 motion-reduce:animate-none'
  if (dieResult.result === 1)
    return 'inline-block animate-nat-one text-red-700 motion-reduce:animate-none'
  return null
}

function open(newResult: RequestResolutionArgs | null | undefined) {
  result.value = newResult
  modal.value?.open()
}

function close() {
  modal.value?.close()
}

const isOpen = computed(() => modal.value?.isOpen ?? false)

defineExpose({ open, close, isOpen })
</script>

<template>
  <Modal ref="modal">
    <div class="flex">
      <div class="m-auto">
        <div class="m-auto">{{ roll?.formula }}</div>
        <div
          class="flex items-center justify-center"
          v-for="(die, i) in rollDice"
          :key="'die_' + i"
        >
          <div class="flex gap-1 text-2xl">
            <div
              v-for="(dieResult, j) in die.results"
              :key="'result_' + j"
              class="align-items-center mr-1 flex gap-1"
            >
              <img
                v-if="dieIconForFaces(die.faces)"
                :src="dieIconForFaces(die.faces)"
                class="mt-1 h-6 w-6"
                :alt="$t('infoModal.dieImage', { faces: die.faces })"
              />
              <span :class="d20ResultClass(dieResult)">
                {{ roll?.isSecret ? '?' : dieResult.result }}
              </span>
            </div>
          </div>
        </div>
      </div>
      <div class="m-auto">
        <div class="text-6xl">
          {{ roll?.isSecret ? '???' : roll?.total }}
        </div>
      </div>
    </div>
  </Modal>
</template>
