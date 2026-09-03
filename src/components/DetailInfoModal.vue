<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { Item } from '@/composables/character'
import type { ActionFrequency } from '@/composables/character/defs/action'
import type { ActiveRoll } from '@/types/api-types'
import { useRollsFromActiveRoll } from '@/composables/useRollsFromActiveRoll'
import { useTraitLabels } from '@/composables/useTraitLabels'
import CounterWidget from '@/components/widgets/CounterWidget.vue'
import InfoModal from '@/components/InfoModal.vue'
import ParsedDescription from '@/components/ParsedDescription.vue'
import UsesWidget from '@/components/widgets/UsesWidget.vue'

// The standard "view an item's details" bottom sheet shared by the simple
// item lists (actions, feats, ancestry/background/class, familiar abilities):
// image + send-to-chat header, name title, level/rarity line, enriched
// description with selectable inline rolls wired to the modal's roll buttons.
// Slots override the standard parts where a sheet needs more; the richer
// panels (spells, equipment, strikes) have their own detail components and
// use InfoModal directly.
//
// Teleports itself to #modals — callers just render it wherever convenient.

const props = defineProps<{
  item: Item | undefined
  // The character's rollOptionLabels, for localizing @Check/@Action labels.
  labels?: Record<string, string>
  // A limited-use ability's Frequency. The list row's own UsesWidget is
  // read-only by deliberate design — it is a link into this modal, which is
  // where the count is owned and corrected. PF2e splits the same two jobs the
  // same way round, just on one line: pips-equivalent display beside a number
  // input the player can type into.
  uses?: ActionFrequency | null
  // Write the remaining uses. Absent when nothing can set them (no Frequency,
  // or a list that only displays), which is also what makes the counter
  // read-only rather than hiding it — a count you can see but not fix still
  // answers "do I have this left?".
  setUses?: (newValue: number) => unknown
}>()

const infoModal = ref<InstanceType<typeof InfoModal>>()
const usesCounter = ref<InstanceType<typeof CounterWidget>>()
const description = ref<InstanceType<typeof ParsedDescription>>()
const activeRoll = ref<ActiveRoll>()
const inlineRolls = useRollsFromActiveRoll(activeRoll)
const { labelFor: rarityLabel } = useTraitLabels()

// Clamped the same way UsesWidget clamps: a rule element that over-spends a
// pool must not render negative or overflowing pips, and `value` is absent on
// an unspent Frequency (PF2e fills it from `max` at prepare time).
const usesMax = computed(() =>
  typeof props.uses?.max === 'number' && props.uses.max > 0 ? props.uses.max : 0
)
const usesRemaining = computed(() =>
  Math.min(Math.max(props.uses?.value ?? usesMax.value, 0), usesMax.value)
)

function open() {
  // Drop any roll armed from the previously viewed item before the modal
  // paints, then re-arm from the fresh description once it renders.
  activeRoll.value = undefined
  infoModal.value?.open()
  nextTick(() => description.value?.initRolls())
}

function close(ignoreModal = false) {
  infoModal.value?.close(ignoreModal)
}

defineExpose({ open, close })
</script>

<template>
  <Teleport to="#modals">
    <InfoModal
      ref="infoModal"
      :imageUrl="item?.img ?? undefined"
      :itemId="item?._id ?? undefined"
      :traits="item?.system?.traits?.value ?? undefined"
      :rolls="inlineRolls"
    >
      <template #title>
        <slot name="title">{{ item?.name }}</slot>
      </template>
      <template #description>
        <slot name="description">
          <span v-if="item?.system?.level?.value">
            {{ $t('common.level') }} {{ item?.system?.level?.value }}
          </span>
          <span v-if="item?.system?.traits?.rarity" class="text-sm">
            ({{ rarityLabel(item?.system?.traits?.rarity) }})
          </span>
        </slot>
      </template>
      <!-- Between the name/level line and the description, not in the header's
           top-right corner: that corner is a few pixels of gap beside the close
           button, and a tap target that shares an edge with "dismiss" is the
           wrong place to put a destructive-feeling one. Labelled, and on its own
           row, it also reads as part of the ability rather than as chrome. -->
      <template #beforeBody v-if="usesMax > 0">
        <div data-part="uses-counter" class="mt-3 flex justify-end">
          <!-- The SAME widget the list row draws, deliberately: this modal is
               what that row links to, and a count that changed shape on the way
               in would read as a different number. It also already solves the
               alignment CounterWidget's own pips can't — the pip strip there
               hangs 6px below its box (an inner `mt-1.5` against `h-full`), so
               laying it out beside text aligns the boxes but not what's drawn
               in them, which is why every other call site carries a different
               hand-tuned offset. UsesWidget sits in an inline formatting
               context and puts its pips on the label's real baseline. -->
          <button
            type="button"
            class="text-sm"
            :class="setUses ? 'cursor-pointer' : 'cursor-default'"
            :disabled="!setUses"
            @click="usesCounter?.click()"
          >
            {{ $t('actions.usesLabel') }}
            <UsesWidget :value="usesRemaining" :max="usesMax" :per="uses?.perLabel" />
          </button>
          <!-- Rendered only for the +/- stepper it teleports to #modals, which
               is the same sheet consumable charges and innate spell uses open —
               so the display above stays one widget and the editing stays one
               interaction. Hiding the root doesn't reach the stepper: Teleport
               relocates it out of this subtree. Same `ref().click()` handoff
               HeroPoints uses to open it from its StatBox. -->
          <CounterWidget
            ref="usesCounter"
            class="hidden"
            :title="`${item?.name ?? ''} (${$t('actions.usesLabel')})`"
            :value="usesRemaining"
            :max="usesMax"
            editable
            @changeCount="(newValue: number) => setUses?.(newValue)"
          />
        </div>
      </template>
      <template #body>
        <ParsedDescription
          ref="description"
          :text="item?.system?.description?.value"
          :labels="labels"
          :itemId="item?._id ?? undefined"
          @update:activeRoll="activeRoll = $event"
        />
        <slot name="bodyExtra"></slot>
      </template>
      <template #actionButtons>
        <slot name="actionButtons"></slot>
      </template>
    </InfoModal>
  </Teleport>
</template>
