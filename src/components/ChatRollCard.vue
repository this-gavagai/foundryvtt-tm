<script setup lang="ts">
import { messageIsReroll, type ChatMessageView } from '@/composables/useChatMessages'
import type { ChatActions } from '@/composables/useChatActions'
import { triggerLightHapticFeedback } from '@/composables/useHapticFeedback'
import {
  rollDieIcon,
  rollDieLabel,
  rollDisplayText,
  rollFlavorLabel,
  rollFormulaLabel,
  rollKindLabel
} from '@/utils/chatRollDisplay'
import ChatRerollMenu from '@/components/ChatRerollMenu.vue'
import d20Icon from '@/assets/icons/d20.svg'
import type { ApplyDamageMode, ChatRollRerollMode } from '@/types/api-types'
import type { ChatRollSummary } from '@/utils/chatRollSummary'

const props = defineProps<{
  view: ChatMessageView
  roll: ChatRollSummary
  rollIndex: number
  actions: ChatActions
}>()

const emit = defineEmits<{
  openReroll: [mode: ChatRollRerollMode]
}>()

// The non-healing damage buttons differ only in mode, label, and accent color.
// `action` keys match the pre-refactor data-action attributes.
const damageModes: {
  mode: ApplyDamageMode
  labelKey: string
  classes: string
}[] = [
  {
    mode: 'damage',
    labelKey: 'chat.damage',
    classes: 'border-red-200 bg-red-50 text-red-800 hover:bg-red-100 active:bg-red-200'
  },
  {
    mode: 'half',
    labelKey: 'chat.half',
    classes: 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100 active:bg-gray-200'
  },
  {
    mode: 'double',
    labelKey: 'chat.double',
    classes: 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100 active:bg-gray-200'
  },
  {
    mode: 'block',
    labelKey: 'chat.block',
    classes: 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100 active:bg-blue-200'
  }
]

function applyDamage(mode: ApplyDamageMode) {
  props.actions.applyDamageRoll(props.view.message, props.roll, props.rollIndex, mode)
}
</script>

<template>
  <div
    data-part="chat-roll"
    class="relative rounded border border-gray-200 bg-white px-3 py-2 text-sm"
    :class="messageIsReroll(view.message) ? 'pr-24' : 'pr-10'"
  >
    <span
      v-if="messageIsReroll(view.message)"
      data-part="chat-rerolled-label"
      class="absolute top-2 right-2 text-xs font-semibold tracking-wide uppercase"
    >
      REROLLED
    </span>
    <ChatRerollMenu
      v-else-if="actions.canReroll(view.message, roll)"
      :can-trigger="(mode) => actions.canTriggerRollAction(view.message, roll, rollIndex, mode)"
      :pending="actions.isRollActionPending(view.message, rollIndex)"
      @select="(mode) => emit('openReroll', mode)"
    />
    <div
      v-if="view.rerollSummary?.formula || roll.formula || roll.dice.length"
      data-part="chat-roll-details"
      class="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-gray-500"
    >
      <span
        v-if="view.rerollSummary?.formula || roll.formula"
        data-part="chat-roll-formula"
        class="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 break-words text-gray-600"
      >
        {{
          view.rerollSummary?.formula
            ? rollDisplayText(view.rerollSummary.formula)
            : rollFormulaLabel(roll)
        }}
      </span>
      <span
        v-if="view.rerollSummary || roll.dice.length"
        data-part="chat-roll-dice"
        class="flex flex-wrap items-center gap-x-1.5 gap-y-1"
      >
        <template v-if="view.rerollSummary">
          <span
            data-part="chat-roll-die"
            class="inline-flex items-center gap-1 leading-none text-gray-500"
          >
            <img :src="d20Icon" class="h-4 w-4 opacity-45" alt="" aria-hidden="true" />
            <span :class="view.rerollSummary.oldDiscarded ? 'line-through opacity-60' : ''">
              {{ view.rerollSummary.oldDie }}
            </span>
          </span>
          <span data-part="chat-reroll-arrow">-&gt;</span>
          <span
            data-part="chat-roll-die"
            class="inline-flex items-center gap-1 leading-none text-gray-500"
          >
            <img :src="d20Icon" class="h-4 w-4 opacity-45" alt="" aria-hidden="true" />
            <span :class="view.rerollSummary.newDiscarded ? 'line-through opacity-60' : ''">
              {{ view.rerollSummary.newDie }}
            </span>
          </span>
        </template>
        <template v-for="(die, dieIndex) in roll.dice" v-else :key="dieIndex">
          <template v-if="die.results.length">
            <span
              v-for="(result, resultIndex) in die.results"
              :key="resultIndex"
              data-part="chat-roll-die"
              class="inline-flex items-center gap-1 leading-none text-gray-500"
              :title="rollDieLabel(die)"
            >
              <img :src="rollDieIcon(die)" class="h-4 w-4 opacity-45" alt="" aria-hidden="true" />
              <span>{{ result }}</span>
            </span>
          </template>
          <span
            v-else
            data-part="chat-roll-die"
            class="inline-flex items-center leading-none text-gray-500"
            :title="rollDieLabel(die)"
          >
            <img :src="rollDieIcon(die)" class="h-4 w-4 opacity-45" alt="" aria-hidden="true" />
          </span>
        </template>
      </span>
    </div>
    <div class="mt-2 flex flex-wrap items-baseline gap-1.5">
      <span class="text-xs font-semibold tracking-wide text-gray-500 uppercase">
        {{ rollKindLabel(roll) }}
      </span>
      <span
        v-if="view.rerollSummary"
        data-part="chat-reroll-total"
        class="inline-flex items-baseline gap-1.5 text-base font-semibold"
      >
        <span :class="view.rerollSummary.oldDiscarded ? 'line-through opacity-60' : ''">
          {{ view.rerollSummary.oldTotal }}
        </span>
        <span data-part="chat-reroll-arrow">-&gt;</span>
        <span :class="view.rerollSummary.newDiscarded ? 'line-through opacity-60' : ''">
          {{ view.rerollSummary.newTotal }}
        </span>
      </span>
      <span v-else-if="roll.total !== undefined" class="text-base font-semibold">
        {{ roll.total }}
      </span>
      <span
        v-if="roll.flavors.length"
        data-part="chat-roll-flavor"
        class="min-w-0 text-xs break-words text-gray-500"
      >
        {{ rollFlavorLabel(roll) }}
      </span>
    </div>
    <div
      v-if="actions.canApplyDamage(roll)"
      data-part="chat-damage-actions"
      class="mt-2 flex flex-wrap gap-1.5"
    >
      <button
        v-if="roll.isHealing"
        type="button"
        data-action="heal"
        class="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800 transition-colors hover:bg-emerald-100 active:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="!actions.canTriggerDamageAction(view.message, roll, rollIndex, 'heal')"
        :aria-busy="actions.isDamageActionPending(view.message, rollIndex)"
        @pointerdown="triggerLightHapticFeedback()"
        @click="applyDamage('heal')"
      >
        {{ $t('chat.heal') }}
      </button>
      <template v-else>
        <button
          v-for="entry in damageModes"
          :key="entry.mode"
          type="button"
          :data-action="entry.mode"
          class="rounded border px-2 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          :class="entry.classes"
          :disabled="!actions.canTriggerDamageAction(view.message, roll, rollIndex, entry.mode)"
          :aria-busy="actions.isDamageActionPending(view.message, rollIndex)"
          @pointerdown="triggerLightHapticFeedback()"
          @click="applyDamage(entry.mode)"
        >
          {{ $t(entry.labelKey) }}
        </button>
      </template>
    </div>
  </div>
</template>
