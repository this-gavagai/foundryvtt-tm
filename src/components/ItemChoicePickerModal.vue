<script setup lang="ts">
// The choices PF2e would otherwise ask the GM to make on a player's behalf.
//
// A ChoiceSet rule element stops item creation and awaits a dialog. Because the
// module creates compendium items on the elected GM's client, that dialog used
// to open on the GM's screen for a choice belonging to whoever tapped Add. The
// module now describes the question instead (GET_ITEM_CHOICES) and this asks it
// here, on the device of the person whose character it is.
//
// One question at a time, and re-asked after each answer: a ChoiceSet whose
// options are built from an earlier one's selection can only be inflated once
// that selection is known, so the caller loops rather than rendering a form.
import { ref, watch } from 'vue'
import ModalBox from './ModalBox.vue'
import Button from './widgets/ButtonWidget.vue'
import type { ItemChoiceSet } from '@/types/api-types'

const modal = ref<InstanceType<typeof ModalBox>>()
const choice = ref<ItemChoiceSet | null>(null)
let resolvePromise: ((value: string | number | null) => void) | null = null

/**
 * Ask one question. Resolves with the chosen value, or null if the player
 * dismissed it — in which case the caller abandons the add rather than sending a
 * half-answered create, which the module would refuse anyway.
 */
function open(pending: ItemChoiceSet): Promise<string | number | null> {
  choice.value = pending
  modal.value?.open()
  return new Promise((resolve) => {
    resolvePromise = resolve
  })
}

function select(value: string | number) {
  resolvePromise?.(value)
  resolvePromise = null
  modal.value?.close()
}

function cancel() {
  resolvePromise?.(null)
  resolvePromise = null
  modal.value?.close()
}

// ModalBox can also be dismissed by the backdrop or Escape, which it handles
// internally and reports to no one. Without this a dismissed picker would leave
// the caller's promise pending for good, and the add would hang with its
// spinner up. Watching the modal's own exposed `isOpen` covers every route out.
watch(
  () => modal.value?.isOpen,
  (open, wasOpen) => {
    if (wasOpen && !open && resolvePromise) {
      resolvePromise(null)
      resolvePromise = null
    }
  }
)

defineExpose({ open })
</script>

<template>
  <ModalBox ref="modal" :title="choice?.label || $t('compendium.chooseTitle')" :noX="true">
    <div class="mt-4 flex flex-col gap-2">
      <!-- The module's own prompt text, already localized there: the CONFIG
           catalog these strings come from lives only on a Foundry client. -->
      <p v-if="choice?.prompt" class="text-sm">{{ choice.prompt }}</p>

      <!-- A question with nothing to pick from: a drop-only ChoiceSet, which
           PF2e satisfies by dragging an item onto its own dialog. There is no
           list to render, so say so plainly rather than offer an empty box. -->
      <p v-if="choice?.unanswerable" class="text-sm text-gray-500 italic">
        {{ $t('compendium.chooseUnavailable') }}
      </p>

      <template v-else>
        <button
          v-for="option in choice?.options ?? []"
          :key="String(option.value)"
          type="button"
          data-part="choice-option"
          class="flex cursor-pointer items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-left text-sm transition-colors hover:bg-gray-50 active:bg-gray-100"
          @click="select(option.value)"
        >
          <img
            v-if="option.img"
            :src="option.img"
            alt=""
            class="h-6 w-6 shrink-0 rounded-sm object-cover"
          />
          <span>{{ option.label }}</span>
        </button>
      </template>

      <div class="mt-2 flex flex-row-reverse">
        <Button color="gray" :clicked="cancel" :label="$t('common.cancel')" />
      </div>
    </div>
  </ModalBox>
</template>
