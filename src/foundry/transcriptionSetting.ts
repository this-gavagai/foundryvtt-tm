// World-scoped GM settings for AI transcription of voice memos, plus the
// client-side call that performs it. When an endpoint + API key are configured
// the GM's Foundry client transcribes each uploaded memo (see finalizeVoiceMemo
// in handlers/chat.ts) and stores the text in flags.tablemate.transcript; the
// app renders it beneath the audio player. Only the GM's client ever holds the
// key or calls the API — the tablet never does, so there is no per-device key
// and no CapacitorHttp/CORS path to worry about on the app side.
//
// The endpoint is any OpenAI-compatible /audio/transcriptions service (OpenAI,
// Groq, a local whisper server, …): base URL + bearer key + model name. With no
// endpoint or key set, transcription is simply skipped and memos post as before.
//
// The API key is stored CLIENT-scoped, not world-scoped: Foundry broadcasts
// world settings to every connected client (a player could read a world-scoped
// key via game.settings.get), whereas a client-scoped setting lives only in the
// browser that set it and is never synced. Since transcription runs solely on
// the GM's client, the key stays on the GM's machine and never reaches players.
// Its config field is shown to the GM only. The trade-off: it is per-browser, so
// the GM re-enters it if they host the world from a different machine. Endpoint
// and model are non-secret, so they stay world-scoped (set once, shareable).

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
      'Bearer key for the transcription endpoint above. Stored only in this ' +
      'browser (client-scoped) and never sent to players, so set it on the ' +
      'machine you run the game from. Shown to the GM only.',
    // Client-scoped so the key never syncs to other clients; visible only to the
    // GM (registration runs on every client, but the field is hidden elsewhere).
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

// The world's transcription config, or null when unconfigured (no endpoint or no
// key) — in which case memos post without a transcript. The endpoint's trailing
// slash is stripped so joining "/audio/transcriptions" never doubles up.
export function transcriptionConfig(): TranscriptionConfig | null {
  const endpoint = readStr(TRANSCRIPTION_ENDPOINT_SETTING).replace(/\/+$/, '')
  const apiKey = readStr(TRANSCRIPTION_API_KEY_SETTING)
  if (!endpoint || !apiKey) return null
  const model = readStr(TRANSCRIPTION_MODEL_SETTING) || DEFAULT_MODEL
  return { endpoint, apiKey, model }
}

// Whether transcription is enabled for this world.
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
