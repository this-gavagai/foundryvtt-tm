import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { DEFAULT_TRANSCRIPTION_MODEL, type TranscriptionConfig } from '@/api/transcription'
import { readTranscriptionKey, writeTranscriptionKey } from '@/api/transcriptionKeyStore'

const MANUAL_DICE_PICKER_KEY = 'tm-manual-dice-picker'
const SHOW_UNREAD_ON_PORTRAIT_KEY = 'tm-show-unread-on-portrait'
const SHOW_SHARED_IMAGES_KEY = 'tm-show-shared-images'
const TRANSCRIPTION_ENABLED_KEY = 'tm-transcription-enabled'
const TRANSCRIPTION_ENDPOINT_KEY = 'tm-transcription-endpoint'
const TRANSCRIPTION_MODEL_KEY = 'tm-transcription-model'
const TRANSCRIPTION_PARAGRAPHS_KEY = 'tm-transcription-paragraphs'
const TRANSCRIPTION_PARAGRAPH_MODEL_KEY = 'tm-transcription-paragraph-model'

function loadManualDicePicker(): boolean {
  return localStorage.getItem(MANUAL_DICE_PICKER_KEY) === '1'
}

function loadShowUnreadOnPortrait(): boolean {
  return localStorage.getItem(SHOW_UNREAD_ON_PORTRAIT_KEY) === '1'
}

function loadShowSharedImages(): boolean {
  return localStorage.getItem(SHOW_SHARED_IMAGES_KEY) === '1'
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

  // When enabled, an image a GM shares from Foundry (the core "show players"
  // action) pops up over the sheet. Off by default: an unsolicited full-screen
  // popup on someone else's action is exactly the kind of interruption a player
  // should have to opt into. Persisted to localStorage.
  const showSharedImages = ref(loadShowSharedImages())
  watch(showSharedImages, (v) => persistFlag(SHOW_SHARED_IMAGES_KEY, v))

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

  // Optional second pass that breaks a long transcript into paragraphs, using a
  // chat model on the SAME endpoint and key (see addTranscriptParagraphs).
  const transcriptionParagraphs = ref(localStorage.getItem(TRANSCRIPTION_PARAGRAPHS_KEY) === '1')
  watch(transcriptionParagraphs, (v) => persistFlag(TRANSCRIPTION_PARAGRAPHS_KEY, v))

  const transcriptionParagraphModel = ref(
    localStorage.getItem(TRANSCRIPTION_PARAGRAPH_MODEL_KEY) ?? ''
  )
  watch(transcriptionParagraphModel, (v) =>
    persistText(TRANSCRIPTION_PARAGRAPH_MODEL_KEY, v.trim())
  )

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
    const paragraphModel = transcriptionParagraphModel.value.trim()
    return {
      endpoint,
      apiKey,
      model: transcriptionModel.value.trim() || DEFAULT_TRANSCRIPTION_MODEL,
      // Undefined unless both switched on and named — the paragraph pass is off
      // by default and costs a second call, so it never runs by accident.
      paragraphModel: transcriptionParagraphs.value && paragraphModel ? paragraphModel : undefined
    }
  })

  return {
    skipCharacterAlts,
    manualDicePicker,
    showUnreadOnPortrait,
    showSharedImages,
    transcriptionEnabled,
    transcriptionEndpoint,
    transcriptionModel,
    transcriptionParagraphs,
    transcriptionParagraphModel,
    transcriptionApiKey,
    transcriptionKeyLoaded,
    setTranscriptionApiKey,
    transcriptionConfig
  }
})
