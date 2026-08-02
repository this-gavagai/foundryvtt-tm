// GM settings for AI transcription of voice memos, plus the client-side call
// that performs it. When an endpoint + API key are configured the GM's Foundry
// client transcribes each uploaded memo (see finalizeVoiceMemo in
// handlers/chat.ts) and stores the text in flags.tablemate.transcript; the app
// renders it beneath the audio player. Only the GM's client ever holds the key
// or calls the API — the tablet never does, so there is no per-device key and no
// CapacitorHttp/CORS path to worry about on the app side.
//
// The endpoint is any OpenAI-compatible /audio/transcriptions service (OpenAI,
// Groq, a local whisper server, …): base URL + bearer key + model name. With no
// endpoint or key set, transcription is simply skipped and memos post as before.
//
// Scope is split deliberately. The endpoint and model are not secret and are
// WORLD-scoped, so they are configured once for the table. The API key is
// CLIENT-scoped, because Foundry syncs world settings to every connected client
// — a world-scoped key is readable by any player via game.settings.get, and a
// billable API credential is not something to hand out with the login. Its
// config field is GM-gated as well, so it stays out of players' settings UI
// entirely.
//
// The cost of client scope is that the key lives in one browser's local storage:
// a GM who transcribes from a second machine pastes it there too, and clearing
// site data loses it. That is the right trade for a credential.

import { MODULE_ID } from '@/api/protocol'

declare const game: {
  settings: {
    register: (scope: string, key: string, config: object) => void
    get: (scope: string, key: string) => unknown
  }
  user?: { isGM?: boolean }
}

export const TRANSCRIPTION_ENDPOINT_SETTING = 'transcriptionEndpoint'
export const TRANSCRIPTION_API_KEY_SETTING = 'transcriptionApiKey'
export const TRANSCRIPTION_MODEL_SETTING = 'transcriptionModel'

const DEFAULT_MODEL = 'whisper-1'

// How long to wait on the transcription API before giving up and posting the
// memo without a transcript. Short clips return in a second or two; this only
// bounds a hung/slow endpoint so a memo never stalls indefinitely.
const TRANSCRIPTION_TIMEOUT_MS = 30_000

// Setting strings are raw English, matching the other module settings (the
// module ships no Foundry lang files).
export function registerTranscriptionSetting() {
  game.settings.register(MODULE_ID, TRANSCRIPTION_ENDPOINT_SETTING, {
    name: 'Voice memo transcription endpoint',
    hint:
      'Base URL of an OpenAI-compatible transcription API, e.g. ' +
      '"https://api.openai.com/v1" (OpenAI) or "https://api.groq.com/openai/v1" ' +
      '(Groq). Leave blank to disable transcription — memos still record and ' +
      "play, just without text. The GM's Foundry client makes the call; the " +
      'app never does.',
    scope: 'world',
    config: true,
    type: String,
    default: ''
  })
  game.settings.register(MODULE_ID, TRANSCRIPTION_API_KEY_SETTING, {
    name: 'Voice memo transcription API key',
    hint:
      'Bearer key for the transcription endpoint above. Stored in THIS browser ' +
      'only and never synced to other clients, so enter it on whichever GM ' +
      'browser handles Tabula Mensa requests (and again on any other GM machine ' +
      'you transcribe from). Leave blank to disable transcription.',
    // Client-scoped: world settings sync to every connected client, so a
    // world-scoped key is readable by any player via game.settings.get. config is
    // GM-gated as well, keeping the field out of players' settings UI.
    scope: 'client',
    config: !!game.user?.isGM,
    type: String,
    default: ''
  })
  game.settings.register(MODULE_ID, TRANSCRIPTION_MODEL_SETTING, {
    name: 'Voice memo transcription model',
    hint:
      'Model to request, e.g. "whisper-1" or "gpt-4o-mini-transcribe" (OpenAI) ' +
      'or "whisper-large-v3-turbo" (Groq).',
    scope: 'world',
    config: true,
    type: String,
    default: DEFAULT_MODEL
  })
}

export interface TranscriptionConfig {
  endpoint: string
  apiKey: string
  model: string
}

function readStr(key: string): string {
  try {
    return String(game.settings.get(MODULE_ID, key) ?? '').trim()
  } catch {
    // Setting not registered yet (or an unexpectedly old world): treat as
    // unconfigured, i.e. transcription disabled.
    return ''
  }
}

// What THIS client can transcribe with, or null when unconfigured (no endpoint,
// or no key in this browser) — in which case memos post without a transcript.
// The endpoint's trailing slash is stripped so joining "/audio/transcriptions"
// never doubles up.
export function transcriptionConfig(): TranscriptionConfig | null {
  const endpoint = readStr(TRANSCRIPTION_ENDPOINT_SETTING).replace(/\/+$/, '')
  const apiKey = readStr(TRANSCRIPTION_API_KEY_SETTING)
  if (!endpoint || !apiKey) return null
  const model = readStr(TRANSCRIPTION_MODEL_SETTING) || DEFAULT_MODEL
  return { endpoint, apiKey, model }
}

// Whether THIS client can transcribe. Since the key is client-scoped, that is
// not quite the same question as "does this world transcribe": the GM browser
// handling voice memos and the one elected to send push notifications can be
// different clients (gmHandlerSetting vs game.users.activeGM). A pushing GM
// without the key reads false here and so does not hold the notification for a
// transcript that is in fact coming — the banner says "Voice message" instead of
// carrying the words. Only in a multi-GM world, and only a nicety lost; the memo
// still transcribes on the client that has the key.
export function transcriptionEnabled(): boolean {
  return transcriptionConfig() !== null
}

// POST the audio to {endpoint}/audio/transcriptions as multipart/form-data — the
// shape OpenAI, Groq, and other OpenAI-compatible servers share — and return the
// transcript text. Throws on a non-2xx response, timeout, or empty result; the
// caller treats any failure as "no transcript" and still posts the memo.
export async function transcribeAudioFile(file: File, config: TranscriptionConfig): Promise<string> {
  const form = new FormData()
  // Do not set Content-Type by hand — fetch derives the multipart boundary from
  // the FormData body, and a manual header would omit it and break the upload.
  form.append('file', file, file.name)
  form.append('model', config.model)

  const controller = new AbortController()
  const timer = globalThis.setTimeout(() => controller.abort(), TRANSCRIPTION_TIMEOUT_MS)
  try {
    const res = await fetch(`${config.endpoint}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: form,
      signal: controller.signal
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`transcription HTTP ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`)
    }
    const data = (await res.json()) as { text?: unknown }
    const text = typeof data.text === 'string' ? data.text.trim() : ''
    if (!text) throw new Error('transcription response had no text')
    return text
  } finally {
    globalThis.clearTimeout(timer)
  }
}
