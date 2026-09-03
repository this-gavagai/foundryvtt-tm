<script setup lang="ts">
import { computed } from 'vue'
import PipWidget from '@/components/widgets/PipWidget.vue'

// Remaining limited uses on a list row — an action's Frequency ("1 per day") or
// a consumable's charges. Read-only on purpose: every row that carries one is a
// link into the item's own modal, which already owns the spend/restore counter.
//
// A small pool reads fastest as pips (the same PipWidget hero points use); past
// PIP_LIMIT they stop being countable at a glance, so the widget switches to
// "7/12". Everything inherits `currentColor` and the row's font size, so a
// dimmed or italicised row dims its uses with it.
const props = defineProps<{
  value?: number | null
  max?: number | null
  // The recharge period as a ready-made phrase ("per day"), already localized
  // Foundry-side. It leads the indicator: a pool of pips says nothing on its
  // own about when they come back, and that is half of what a player is
  // checking. Consumable charges have no period and pass nothing.
  per?: string | null
}>()

const PIP_LIMIT = 5

const max = computed(() => (typeof props.max === 'number' && props.max > 0 ? props.max : 0))
// An unspent frequency arrives with no `value` (PF2e fills it from `max` at
// prepare time); clamp, so a rule element that over-spends a pool can't render
// negative or overflowing pips.
const remaining = computed(() => Math.min(Math.max(props.value ?? max.value, 0), max.value))
const asPips = computed(() => max.value <= PIP_LIMIT)
</script>

<template>
  <!-- Plain inline layout, NOT a flex row, and deliberately so. Every row that
       hosts this baseline-aligns it against an item name a good deal larger
       than this text. A flex container nested as a flex item doesn't hand its
       text baseline up: the browser synthesizes one from the bottom margin
       edge instead, which lands the box's bottom on the name's baseline and
       leaves "7/7" floating above the line. An inline formatting context has a
       real first-line baseline, so the digits sit on the name's. Only the pip
       strip stays a flex row — it holds no text to misalign. -->
  <span v-if="max > 0" data-part="uses" class="text-xs font-normal whitespace-nowrap">
    <span v-if="per" class="mr-1">{{ per }}</span>
    <!-- The pip box has no baseline of its own, so it sits ON the text
         baseline — which puts a 10px pip at about the cap height of the row's
         name, reading as one line with it. -->
    <span v-if="asPips" class="inline-flex h-2.5 items-center gap-px">
      <PipWidget v-for="i in max" :key="i" :filled="i <= remaining" class="h-full" />
    </span>
    <span v-else class="tabular-nums">{{ remaining }}/{{ max }}</span>
  </span>
</template>
