<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useDebounceFn } from '@vueuse/core'
import { useSettingsStore } from '@/stores/settings'
import ModalBox from './ModalBox.vue'
import Toggle from '@/components/widgets/ToggleWidget.vue'

// Settings submenu (opened from SettingsModal) for this device's voice memo
// transcription: an OpenAI-compatible endpoint, a bearer key, and a model.
//
// Per-device by design — the app transcribes the memos IT records, using this
// device's own service (see api/transcription.ts). With transcription off or
// incompletely configured, memos post exactly as before, just without text.

const settings = useSettingsStore()
const {
  transcriptionEnabled,
  transcriptionEndpoint,
  transcriptionModel,
  transcriptionApiKey,
  transcriptionKeyLoaded
} = storeToRefs(settings)

// The key is written to the OS keystore, so persist a beat after typing stops
// rather than once per keystroke. The store's ref updates immediately either
// way, so a memo recorded mid-edit already uses what's on screen.
const persistApiKey = useDebounceFn((value: string) => {
  void settings.setTranscriptionApiKey(value)
}, 400)

const apiKey = computed({
  get: () => transcriptionApiKey.value,
  set: (value: string) => {
    transcriptionApiKey.value = value
    persistApiKey(value)
  }
})

// Write it out now rather than on the debounce. Bound to the field's change
// event — which fires on blur, i.e. when the modal is dismissed — because
// ModalBox's own X/backdrop/escape dismissal never reaches close() below.
function commitApiKey() {
  void settings.setTranscriptionApiKey(transcriptionApiKey.value)
}

const modalRef = ref<InstanceType<typeof ModalBox>>()
function open() {
  modalRef.value?.open()
}
function close() {
  commitApiKey()
  modalRef.value?.close()
}

defineExpose({ open, close })
</script>
<template>
  <ModalBox ref="modalRef" :title="$t('settings.transcription.title')">
    <div class="mt-4 flex flex-col gap-4">
      <p data-part="transcription-hint" class="text-sm opacity-70">
        {{ $t('settings.transcription.description') }}
      </p>
      <Toggle :active="transcriptionEnabled" @changed="(v: boolean) => (transcriptionEnabled = v)">
        <span class="text-lg italic">{{ $t('settings.transcription.enable') }}</span>
      </Toggle>
      <label class="flex flex-col gap-1">
        <span class="text-sm italic">{{ $t('settings.transcription.endpoint') }}</span>
        <input
          v-model="transcriptionEndpoint"
          type="url"
          inputmode="url"
          autocapitalize="off"
          autocomplete="off"
          spellcheck="false"
          placeholder="https://api.openai.com/v1"
          class="border-divider rounded border p-2"
        />
        <span data-part="transcription-hint" class="text-xs opacity-70">
          {{ $t('settings.transcription.endpointHint') }}
        </span>
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-sm italic">{{ $t('settings.transcription.apiKey') }}</span>
        <input
          v-model="apiKey"
          @change="commitApiKey"
          type="password"
          autocapitalize="off"
          autocomplete="off"
          spellcheck="false"
          :disabled="!transcriptionKeyLoaded"
          class="border-divider rounded border p-2"
        />
        <span data-part="transcription-hint" class="text-xs opacity-70">
          {{ $t('settings.transcription.apiKeyHint') }}
        </span>
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-sm italic">{{ $t('settings.transcription.model') }}</span>
        <input
          v-model="transcriptionModel"
          type="text"
          autocapitalize="off"
          autocomplete="off"
          spellcheck="false"
          placeholder="whisper-1"
          class="border-divider rounded border p-2"
        />
        <span data-part="transcription-hint" class="text-xs opacity-70">
          {{ $t('settings.transcription.modelHint') }}
        </span>
      </label>
    </div>
  </ModalBox>
</template>
