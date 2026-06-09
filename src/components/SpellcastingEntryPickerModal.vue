<script setup lang="ts">
import { ref } from 'vue'
import ModalBox from './ModalBox.vue'
import Button from './widgets/ButtonWidget.vue'
import type { SpellcastingEntry } from '@/composables/character'

const modal = ref<InstanceType<typeof ModalBox>>()
const entries = ref<SpellcastingEntry[]>([])
let resolvePromise: ((id: string | null) => void) | null = null

function open(availableEntries: SpellcastingEntry[]): Promise<string | null> {
  entries.value = availableEntries
  modal.value?.open()
  return new Promise((resolve) => {
    resolvePromise = resolve
  })
}

function select(id: string | undefined) {
  if (!id) return
  resolvePromise?.(id)
  resolvePromise = null
  modal.value?.close()
}

function cancel() {
  resolvePromise?.(null)
  resolvePromise = null
  modal.value?.close()
}

function entrySubtitle(entry: SpellcastingEntry): string {
  const prep = entry.system.prepared?.value
  if (prep === 'focus') return 'Focus'
  const tradition = entry.system.tradition?.value
  const parts = [
    tradition ? tradition.charAt(0).toUpperCase() + tradition.slice(1) : null,
    prep ? prep.charAt(0).toUpperCase() + prep.slice(1) : null,
  ].filter(Boolean)
  return parts.join(' · ')
}

defineExpose({ open })
</script>

<template>
  <ModalBox ref="modal" :title="$t('compendium.selectSpellcastingEntry')" :noX="true">
    <div class="mt-4 flex flex-col gap-2">
      <p v-if="entries.length === 0" class="text-sm text-gray-500 italic">
        {{ $t('compendium.noSpellcastingEntries') }}
      </p>
      <template v-else>
        <button
          v-for="entry in entries"
          :key="entry._id"
          type="button"
          data-part="entry-option"
          class="flex flex-col items-start cursor-pointer rounded-md border border-gray-200 px-3 py-2 text-left text-sm transition-colors hover:bg-gray-50 active:bg-gray-100"
          @click="select(entry._id)"
        >
          <span class="font-medium text-gray-900">{{ entry.name }}</span>
          <span class="text-xs text-gray-500">{{ entrySubtitle(entry) }}</span>
        </button>
      </template>
      <div class="mt-2 flex justify-end">
        <Button color="gray" :clicked="cancel">{{ $t('common.cancel') }}</Button>
      </div>
    </div>
  </ModalBox>
</template>
