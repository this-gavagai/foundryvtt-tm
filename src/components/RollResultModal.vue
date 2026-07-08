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

// The die shape is drawn as a CSS mask over currentColor instead of an <img>,
// so it renders solid black on the light chip in every theme — the dark
// theme's global `img[src*='svg'] { filter: invert(0.85) }` would otherwise
// wash it out to pale gray. Both prefixed and standard properties are set for
// older WebKit.
function dieIconStyle(faces: number) {
  const mask = `url('${dieIcons[faces]}') center / contain no-repeat`
  return { mask, '-webkit-mask': mask }
}

const singleD20Result = computed(() => {
  if (roll.value?.isSecret) return null
  const d20Results = rollDice.value
    .filter((die) => die.faces === 20)
    .flatMap((die) => die.results)
  return d20Results.length === 1 ? d20Results[0] : null
})

// Chip tint + animation for the single-d20 highlight. The color sits on the
// chip (not the number span) so the masked die icon, which paints in
// currentColor, tints along with the number.
function dieChipClass(dieResult: DisplayDieResult) {
  if (dieResult !== singleD20Result.value) return 'bg-white text-black ring-gray-900/20'
  if (dieResult.result === 20)
    return 'animate-nat-twenty bg-green-100 text-green-800 ring-green-700/40 motion-reduce:animate-none'
  if (dieResult.result === 1)
    return 'animate-nat-one bg-red-100 text-red-800 ring-red-700/40 motion-reduce:animate-none'
  return 'bg-white text-black ring-gray-900/20'
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
        <div class="m-auto text-center text-sm text-gray-500" data-part="roll-formula">
          {{ roll?.formula }}
        </div>
        <div
          class="flex flex-wrap items-center justify-center gap-1.5 py-1"
          v-for="(die, i) in rollDice"
          :key="'die_' + i"
        >
          <div
            v-for="(dieResult, j) in die.results"
            :key="'result_' + j"
            data-part="roll-die-chip"
            class="flex items-center gap-1.5 rounded-lg px-2 py-1 text-2xl font-semibold shadow-sm ring-1"
            :class="dieChipClass(dieResult)"
          >
            <span
              v-if="dieIconForFaces(die.faces)"
              class="inline-block h-7 w-7 bg-current"
              :style="dieIconStyle(die.faces)"
              role="img"
              :aria-label="$t('infoModal.dieImage', { faces: die.faces })"
            />
            <span>
              {{ roll?.isSecret ? '?' : dieResult.result }}
            </span>
          </div>
        </div>
      </div>
      <div class="m-auto">
        <div class="text-6xl font-semibold">
          {{ roll?.isSecret ? '???' : roll?.total }}
        </div>
      </div>
    </div>
  </Modal>
</template>
