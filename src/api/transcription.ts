// AI transcription of voice memos, performed by the app on the device that
// recorded the memo.
//
// This used to run on the GM's Foundry client from a world setting. It lives
// here now: the recording device already holds the audio, so transcription
// starts the moment the recording stops rather than after the upload has
// crossed to the GM, and a table no longer needs a GM online with a key
// configured for memos to gain text. The trade is that transcription is
// per-device — each app transcribes only the memos IT records, with its own
// endpoint and key (settings store + TranscriptionSettingsModal), and a device
// with nothing configured simply posts memos without text, as before.
//
// The endpoint is any OpenAI-compatible /audio/transcriptions service (OpenAI,
// Groq, a local whisper server, …): base URL + bearer key + model name.
//
// Plain fetch, deliberately: the request is a multipart upload, and
// CapacitorHttp's native layer only carries FormData on web. Both OpenAI and
// Groq answer the preflight for a webview origin (capacitor://localhost), so
// the browser path works on-device; a self-hosted endpoint has to send CORS
// headers of its own to be reachable from the app.

import { logger } from '@/utils/utilities'

export interface TranscriptionConfig {
  endpoint: string
  apiKey: string
  model: string
}

export const DEFAULT_TRANSCRIPTION_MODEL = 'whisper-1'

// How long to wait on the transcription API before giving up and leaving the
// memo audio-only. Short clips return in a second or two; this only bounds a
// hung/slow endpoint so a pending transcription never lingers for the session.
const TRANSCRIPTION_TIMEOUT_MS = 30_000

const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav'
}

// Map a possibly-parameterized MIME ('audio/webm;codecs=opus') to a file
// extension, defaulting to webm for anything unrecognized. The extension is not
// cosmetic: OpenAI (and services that copy its API) reject an upload whose
// filename doesn't name a supported audio format.
export function audioExtension(mimeType: string): string {
  const base = mimeType.split(';')[0].trim().toLowerCase()
  return AUDIO_EXTENSIONS[base] ?? 'webm'
}

// Normalize a user-typed endpoint: trim, drop trailing slashes so joining
// '/audio/transcriptions' never doubles up.
export function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '')
}

// POST the audio to {endpoint}/audio/transcriptions as multipart/form-data — the
// shape OpenAI, Groq, and other OpenAI-compatible servers share — and return the
// transcript text. Throws on a non-2xx response, timeout, or empty result.
export async function transcribeAudio(
  blob: Blob,
  mimeType: string,
  config: TranscriptionConfig
): Promise<string> {
  const form = new FormData()
  // Do not set Content-Type by hand — fetch derives the multipart boundary from
  // the FormData body, and a manual header would omit it and break the upload.
  form.append('file', blob, `memo.${audioExtension(mimeType)}`)
  form.append('model', config.model)

  const controller = new AbortController()
  const timer = globalThis.setTimeout(() => controller.abort(), TRANSCRIPTION_TIMEOUT_MS)
  try {
    const res = await fetch(`${normalizeEndpoint(config.endpoint)}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: form,
      signal: controller.signal
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(
        `transcription HTTP ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`
      )
    }
    const data = (await res.json()) as { text?: unknown }
    const text = typeof data.text === 'string' ? data.text.trim() : ''
    if (!text) throw new Error('transcription response had no text')
    return text
  } finally {
    globalThis.clearTimeout(timer)
  }
}

// Transcribe, or resolve to null on any failure. The caller's fallback is
// always the same — post the memo without text — so every error is a logged
// null rather than something call sites have to handle individually.
export async function transcribeAudioOrNull(
  blob: Blob,
  mimeType: string,
  config: TranscriptionConfig
): Promise<string | null> {
  try {
    return await transcribeAudio(blob, mimeType, config)
  } catch (error) {
    logger.warn('TM-WARN: voice memo transcription failed', error)
    return null
  }
}
