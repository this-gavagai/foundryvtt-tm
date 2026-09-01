<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { MinusIcon, PlusIcon } from '@heroicons/vue/24/solid'
import { useHoldRepeat } from '@/composables/useHoldRepeat'
import { triggerLightHapticFeedback } from '@/composables/useHapticFeedback'
import { formatModifier } from '@/utils/formatters'
import type { Denomination } from '@/utils/coins'

// One denomination's row of the coin panel. Three ways to reach a number,
// because coins move in wildly different sizes: tap a stepper for the current
// step, hold it to run (accelerating), or type the count outright.
//
// The row shows the stored count and, inline beside it, the pending change —
// "143 +7", the way a modifier reads on the rest of the sheet. One number and
// one modifier, in one place: the count never pretends to have already moved,
// and nothing has to be reconciled against a second copy of the same fact
// somewhere else in the row.
const props = defineProps<{
  denomination: Denomination
  /** The stored count for this purse, before the draft. */
  value: number
  /** Pending change against it, shown as a coloured modifier. */
  delta: number
  /** False when the other purse is out of this coin, during a transfer. */
  canIncrease: boolean
  /** False at zero: a purse can't go negative. */
  canDecrease: boolean
}>()

const emit = defineEmits<{
  step: [direction: 1 | -1]
  set: [value: number]
}>()

const { t } = useI18n()
const label = computed(() => t(`coins.denominations.${props.denomination}`))
const fullName = computed(() => t(`coins.names.${props.denomination}`))

// The count sizes to its digits so it and its modifier read as one figure
// rather than as a full-width field with a number lost in the middle of it.
// `ch` is the advance of "0", which the sheet's tabular figures make the width
// of every digit.
const countWidth = computed(() => `${String(props.value).length + 0.6}ch`)

const down = useHoldRepeat(() => emit('step', -1), { enabled: () => props.canDecrease })
const up = useHoldRepeat(() => emit('step', 1), { enabled: () => props.canIncrease })

function press(event: PointerEvent, hold: typeof up) {
  triggerLightHapticFeedback()
  hold.start(event)
}

// Typing names the count you want to end up with; the row turns that into the
// modifier that gets there. A cleared or nonsense field is ignored rather than
// read as zero, which would silently spend a purse.
function commit(event: Event) {
  const input = event.target as HTMLInputElement
  const parsed = Math.floor(Number(input.value))
  if (Number.isFinite(parsed) && parsed >= 0) emit('set', parsed)
  input.value = String(props.value)
}
</script>

<template>
  <li
    data-part="coin-row"
    :data-denomination="denomination"
    :data-changed="delta !== 0 ? 'true' : 'false'"
  >
    <span data-part="coin-badge" aria-hidden="true">{{ label }}</span>
    <button
      type="button"
      data-part="coin-step"
      data-direction="down"
      :disabled="!canDecrease"
      :aria-label="$t('coins.decrease', { coin: fullName })"
      @pointerdown="press($event, down)"
      @contextmenu.prevent
    >
      <MinusIcon class="h-5 w-5" />
    </button>
    <span data-part="coin-figure">
      <input
        data-part="coin-count"
        type="text"
        inputmode="numeric"
        :style="{ width: countWidth }"
        :aria-label="fullName"
        :value="value"
        @focus="(e) => (e.target as HTMLInputElement).select()"
        @blur="commit"
        @keyup.enter="(e) => (e.target as HTMLInputElement).blur()"
      />
      <span
        v-if="delta !== 0"
        data-part="coin-modifier"
        :data-sign="delta > 0 ? 'up' : 'down'"
        :aria-label="$t('coins.pendingChange', { change: formatModifier(delta) })"
      >
        {{ formatModifier(delta) }}
      </span>
    </span>
    <button
      type="button"
      data-part="coin-step"
      data-direction="up"
      :disabled="!canIncrease"
      :aria-label="$t('coins.increase', { coin: fullName })"
      @pointerdown="press($event, up)"
      @contextmenu.prevent
    >
      <PlusIcon class="h-5 w-5" />
    </button>
  </li>
</template>
