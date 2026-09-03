<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import d4Icon from '@/assets/icons/d4.svg'
import d6Icon from '@/assets/icons/d6.svg'
import d8Icon from '@/assets/icons/d8.svg'
import d10Icon from '@/assets/icons/d10.svg'
import d12Icon from '@/assets/icons/d12.svg'
import d20Icon from '@/assets/icons/d20.svg'

const dieIcons: Record<string, string> = {
  d4: d4Icon,
  d6: d6Icon,
  d8: d8Icon,
  d10: d10Icon,
  d12: d12Icon,
  d20: d20Icon
}

const props = defineProps<{
  dice: string[]
  buffer: (number | undefined)[]
  dieFaces: (die: string) => number[]
}>()

defineEmits<{
  'pick-face': [slot: number, face: number]
}>()

const root = ref<HTMLElement>()
// Faces per row, per die, for the dice that don't fit on one line. A die absent
// from the map is left to lay out naturally on its single row.
const facesPerRow = ref<Record<string, number>>({})
let widthObserver: ResizeObserver | undefined

// Faces wrap wherever the row runs out of room, which leaves a d20 as a lopsided
// 13 + 7. Splitting them into even rows instead breaks a d20 after 10. The button
// and gap sizes are measured rather than assumed: they come from utility classes
// (and the em-based sizes shift with the client's text size), and being a pixel
// out costs a whole column and cascades into an extra row.
function updateFacesPerRow() {
  const row = root.value?.querySelector<HTMLElement>('[data-part="die-row"]')
  const label = row?.querySelector<HTMLElement>('[data-part="die-label"]')
  const faces = row?.querySelector<HTMLElement>('[data-part="die-faces"]')
  const button = faces?.querySelector('button')
  if (!row || !label || !faces || !button) return

  const rowGap = parseFloat(getComputedStyle(row).columnGap) || 0
  const faceGap = parseFloat(getComputedStyle(faces).columnGap) || 0
  const available = row.clientWidth - label.getBoundingClientRect().width - rowGap
  const faceWidth = button.getBoundingClientRect().width
  if (available <= 0 || faceWidth <= 0) return

  // Half a pixel of slack so a sub-pixel width doesn't drop a whole column.
  const capacity = Math.floor((available + faceGap + 0.5) / (faceWidth + faceGap))
  const next: Record<string, number> = {}
  if (capacity >= 1) {
    for (const die of new Set(props.dice)) {
      const count = props.dieFaces(die).length
      if (capacity >= count) continue
      next[die] = Math.ceil(count / Math.ceil(count / capacity))
    }
  }

  const current = facesPerRow.value
  const changed =
    Object.keys(next).length !== Object.keys(current).length ||
    Object.keys(next).some((die) => next[die] !== current[die])
  if (changed) facesPerRow.value = next
}

function faceRowStyle(die: string) {
  const perRow = facesPerRow.value[die]
  if (!perRow) return undefined
  // Grid columns pin the break exactly at perRow, where a max-width could only
  // approximate it.
  return { display: 'grid', gridTemplateColumns: `repeat(${perRow}, max-content)` }
}

onMounted(() => {
  const el = root.value
  if (!el) return
  widthObserver = new ResizeObserver(() => updateFacesPerRow())
  widthObserver.observe(el)
  void nextTick(updateFacesPerRow)
})

onBeforeUnmount(() => {
  widthObserver?.disconnect()
  widthObserver = undefined
})

watch(
  () => props.dice,
  () => void nextTick(updateFacesPerRow)
)
</script>

<template>
  <div
    ref="root"
    data-component="ManualDicePicker"
    data-part="face-picker"
    class="mt-4 flex flex-col gap-1"
  >
    <div
      v-for="(die, slot) in dice"
      :key="slot + '_' + die"
      data-part="die-row"
      class="flex items-start gap-2"
    >
      <div data-part="die-label" class="flex w-10 shrink-0 items-center gap-1 pt-0.5">
        <img :src="dieIcons[die] ?? d20Icon" class="h-5" />
        <span class="text-xs uppercase opacity-60">{{ die }}</span>
      </div>
      <div data-part="die-faces" class="flex flex-wrap gap-1" :style="faceRowStyle(die)">
        <button
          v-for="face in dieFaces(die)"
          :key="face"
          type="button"
          :data-selected="buffer[slot] === face ? true : undefined"
          class="h-6 w-6 cursor-pointer rounded border text-xs leading-none"
          :class="buffer[slot] === face ? 'bg-gray-300 hover:bg-gray-400' : ''"
          @click="$emit('pick-face', slot, face)"
        >
          {{ face }}
        </button>
      </div>
    </div>
  </div>
</template>
