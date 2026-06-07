<script setup lang="ts">
import { computed, ref } from 'vue'
import Modal from './ModalBox.vue'
import type { RequestResolutionArgs } from '@/types/api-types'

import d4Icon from '@/assets/icons/d4.svg'
import d6Icon from '@/assets/icons/d6.svg'
import d8Icon from '@/assets/icons/d8.svg'
import d10Icon from '@/assets/icons/d10.svg'
import d12Icon from '@/assets/icons/d12.svg'
import d20Icon from '@/assets/icons/d20.svg'

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

const dieIcons: Record<number, string> = {
  4: d4Icon,
  6: d6Icon,
  8: d8Icon,
  10: d10Icon,
  12: d12Icon,
  20: d20Icon
}

function dieIconForFaces(faces: number) {
  return dieIcons[faces]
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
              <span>
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
