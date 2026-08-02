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
  // Chat model that breaks a long transcript into paragraphs, or undefined to
  // leave transcripts as the transcription API returns them. See the paragraph
  // pass below — it reuses this same endpoint and key.
  paragraphModel?: string
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

// ── Paragraphs ───────────────────────────────────────────────────────────────
// Whisper answers with one unbroken wall of text, which is miserable to read on
// a phone once a memo runs past a few sentences. Nothing in the transcription
// call can fix that: OpenAI documents that whisper "doesn't follow instructions
// like a general-purpose text model", and Groq that its prompts "only guide
// style and context, not specific actions". Deciding where a paragraph ends is a
// judgement about meaning, so it takes a model that reads the text.
//
// So this is a second call — to the chat-completions endpoint of the SAME
// service, with the same key, which is why it needs no configuration beyond a
// model name. It is cheap relative to what it formats (a two-minute memo costs
// roughly a ninth of its own transcription on Groq's small models) and it runs
// in the window the user spends reviewing the take, so it usually costs no
// visible time either.
//
// Entirely optional and entirely best-effort: unconfigured, slow, failed, or
// answering with something that isn't the same words — the raw transcript is
// what gets used.

// Below this the memo is a sentence or two and needs no breaking up, so the call
// is skipped outright.
const PARAGRAPH_MIN_CHARS = 400

// Shorter than the transcription budget: this is an enhancement to text we
// already have, so a slow model must not hold the transcript hostage.
const PARAGRAPH_TIMEOUT_MS = 10_000

const PARAGRAPH_SYSTEM_PROMPT =
  'You add paragraph breaks to a transcript of spoken audio. Insert blank lines ' +
  'between distinct topics or turns of thought. Reproduce the text otherwise ' +
  'EXACTLY: never reword, summarise, translate, correct, add, or remove any ' +
  'word or punctuation mark. Reply with the text alone — no commentary, no ' +
  'preamble, no quoting, no markdown.'

// The words of a text, for comparing what came back against what went in.
// Punctuation and whitespace are dropped, so the check ignores exactly what the
// model is allowed to change (line breaks) and catches everything it is not.
function wordSignature(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

// Break a transcript into paragraphs with a chat model. Returns the original
// text unchanged on any failure — including the model having altered the words,
// which is the failure that matters: a transcript is a record of what someone
// said, and a formatting pass that quietly rewrites it would be far worse than
// the wall of text it set out to fix.
export async function addTranscriptParagraphs(
  transcript: string,
  config: TranscriptionConfig
): Promise<string> {
  const model = config.paragraphModel?.trim()
  if (!model || transcript.length < PARAGRAPH_MIN_CHARS) return transcript
  // Already broken up (a transcription API that returns its own line breaks).
  if (transcript.includes('\n\n')) return transcript

  const controller = new AbortController()
  const timer = globalThis.setTimeout(() => controller.abort(), PARAGRAPH_TIMEOUT_MS)
  try {
    const res = await fetch(`${normalizeEndpoint(config.endpoint)}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        // Deterministic: the same memo should not paragraph differently on a
        // retry, and there is nothing here to be creative about.
        temperature: 0,
        messages: [
          { role: 'system', content: PARAGRAPH_SYSTEM_PROMPT },
          { role: 'user', content: transcript }
        ]
      }),
      signal: controller.signal
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`paragraphs HTTP ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`)
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>
    }
    const formatted = data.choices?.[0]?.message?.content
    const text = typeof formatted === 'string' ? formatted.trim() : ''
    if (!text) throw new Error('paragraph response had no text')
    if (wordSignature(text) !== wordSignature(transcript)) {
      throw new Error('paragraph response changed the words; keeping the transcript')
    }
    return text
  } finally {
    globalThis.clearTimeout(timer)
  }
}

// Transcribe, then break the result into paragraphs when a paragraph model is
// configured, or resolve to null on a failed transcription. The caller's
// fallback is always the same — post the memo without text — so every error is
// a logged null rather than something call sites have to handle individually.
// A failed paragraph pass is not an error at all: the transcript stands.
export async function transcribeAudioOrNull(
  blob: Blob,
  mimeType: string,
  config: TranscriptionConfig
): Promise<string | null> {
  let transcript: string
  try {
    transcript = await transcribeAudio(blob, mimeType, config)
  } catch (error) {
    logger.warn('TM-WARN: voice memo transcription failed', error)
    return null
  }
  try {
    return await addTranscriptParagraphs(transcript, config)
  } catch (error) {
    logger.warn('TM-WARN: voice memo paragraph pass failed; using the raw transcript', error)
    return transcript
  }
}
