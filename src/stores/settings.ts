import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { DEFAULT_TRANSCRIPTION_MODEL, type TranscriptionConfig } from '@/api/transcription'
import { readTranscriptionKey, writeTranscriptionKey } from '@/api/transcriptionKeyStore'

const MANUAL_DICE_PICKER_KEY = 'tm-manual-dice-picker'
const SHOW_UNREAD_ON_PORTRAIT_KEY = 'tm-show-unread-on-portrait'
const TRANSCRIPTION_ENABLED_KEY = 'tm-transcription-enabled'
const TRANSCRIPTION_ENDPOINT_KEY = 'tm-transcription-endpoint'
const TRANSCRIPTION_MODEL_KEY = 'tm-transcription-model'

function loadManualDicePicker(): boolean {
  return localStorage.getItem(MANUAL_DICE_PICKER_KEY) === '1'
}

function loadShowUnreadOnPortrait(): boolean {
  return localStorage.getItem(SHOW_UNREAD_ON_PORTRAIT_KEY) === '1'
}

function persistFlag(key: string, value: boolean) {
  if (value) localStorage.setItem(key, '1')
  else localStorage.removeItem(key)
}

function persistText(key: string, value: string) {
  if (value) localStorage.setItem(key, value)
  else localStorage.removeItem(key)
}

export const useSettingsStore = defineStore('settings', () => {
  const skipCharacterAlts = ref(false)
  // When enabled, InfoModal shows a per-die face picker so the user can manually
  // select dice results that get fed into Foundry instead of (or alongside) a
  // Pixel Die roll. Persisted to localStorage so the preference survives reloads.
  const manualDicePicker = ref(loadManualDicePicker())
  watch(manualDicePicker, (v) => persistFlag(MANUAL_DICE_PICKER_KEY, v))

  // When enabled, the character portrait shows a badge with the count of unread
  // chat messages. Off by default so the portrait stays uncluttered; persisted
  // to localStorage so the preference survives reloads.
  const showUnreadOnPortrait = ref(loadShowUnreadOnPortrait())
  watch(showUnreadOnPortrait, (v) => persistFlag(SHOW_UNREAD_ON_PORTRAIT_KEY, v))

  // ── Voice memo transcription ───────────────────────────────────────────────
  // This device's transcription service, used for the memos recorded ON this
  // device (see api/transcription.ts). Endpoint and model are plain preferences;
  // the API key is a credential and lives in the OS keystore where there is one
  // (api/transcriptionKeyStore.ts), which is why it hydrates asynchronously.
  const transcriptionEnabled = ref(localStorage.getItem(TRANSCRIPTION_ENABLED_KEY) === '1')
  watch(transcriptionEnabled, (v) => persistFlag(TRANSCRIPTION_ENABLED_KEY, v))

  const transcriptionEndpoint = ref(localStorage.getItem(TRANSCRIPTION_ENDPOINT_KEY) ?? '')
  watch(transcriptionEndpoint, (v) => persistText(TRANSCRIPTION_ENDPOINT_KEY, v.trim()))

  const transcriptionModel = ref(
    localStorage.getItem(TRANSCRIPTION_MODEL_KEY) || DEFAULT_TRANSCRIPTION_MODEL
  )
  watch(transcriptionModel, (v) => persistText(TRANSCRIPTION_MODEL_KEY, v.trim()))

  const transcriptionApiKey = ref('')
  // False until the keystore read lands, so the settings UI can hold the field
  // disabled rather than show an empty box over a key that does exist.
  const transcriptionKeyLoaded = ref(false)
  void readTranscriptionKey().then((stored) => {
    // Never clobber a key the user typed while the read was in flight.
    if (!transcriptionApiKey.value) transcriptionApiKey.value = stored
    transcriptionKeyLoaded.value = true
  })

  // Explicit setter rather than a watcher: the write is async and must not fire
  // for the hydration assignment above.
  async function setTranscriptionApiKey(value: string): Promise<void> {
    transcriptionApiKey.value = value
    await writeTranscriptionKey(value)
  }

  // What this device can transcribe with, or null when transcription is off or
  // incompletely configured — in which case memos post without text.
  const transcriptionConfig = computed<TranscriptionConfig | null>(() => {
    if (!transcriptionEnabled.value) return null
    const endpoint = transcriptionEndpoint.value.trim()
    const apiKey = transcriptionApiKey.value.trim()
    if (!endpoint || !apiKey) return null
    return {
      endpoint,
      apiKey,
      model: transcriptionModel.value.trim() || DEFAULT_TRANSCRIPTION_MODEL
    }
  })

  return {
    skipCharacterAlts,
    manualDicePicker,
    showUnreadOnPortrait,
    transcriptionEnabled,
    transcriptionEndpoint,
    transcriptionModel,
    transcriptionApiKey,
    transcriptionKeyLoaded,
    setTranscriptionApiKey,
    transcriptionConfig
  }
})
