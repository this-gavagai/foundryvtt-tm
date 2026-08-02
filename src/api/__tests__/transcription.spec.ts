// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  audioExtension,
  normalizeEndpoint,
  transcribeAudio,
  transcribeAudioOrNull
} from '@/api/transcription'

// Transcription moved off the GM's Foundry client onto the device that records
// the memo. These pin the wire shape the OpenAI-compatible endpoints expect —
// getting the multipart body, the filename extension, or the URL join wrong
// fails only at runtime, against a paid API, and looks like "no transcripts".

const config = { endpoint: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'whisper-1' }

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ text: '  the goblin attacks  ' }), { status: 200 })
  )
  ;(globalThis as Record<string, unknown>).fetch = fetchMock
})

function lastRequest(): [string, RequestInit] {
  return fetchMock.mock.calls[0] as unknown as [string, RequestInit]
}

describe('transcribeAudio', () => {
  it('posts the clip as multipart to {endpoint}/audio/transcriptions', async () => {
    const text = await transcribeAudio(new Blob([new Uint8Array([1, 2, 3])]), 'audio/mp4', config)

    expect(text).toBe('the goblin attacks')
    const [url, init] = lastRequest()
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    // No hand-set Content-Type: fetch has to derive the multipart boundary.
    expect(init.headers).not.toHaveProperty('Content-Type')
    expect(init.body).toBeInstanceOf(FormData)
    const form = init.body as FormData
    expect(form.get('model')).toBe('whisper-1')
    // OpenAI rejects an upload whose filename doesn't name a supported format.
    expect((form.get('file') as File).name).toBe('memo.m4a')
  })

  it('does not double up the slash on an endpoint typed with a trailing one', async () => {
    await transcribeAudio(new Blob(['x']), 'audio/webm', {
      ...config,
      endpoint: 'https://api.groq.com/openai/v1/'
    })
    expect(lastRequest()[0]).toBe('https://api.groq.com/openai/v1/audio/transcriptions')
  })

  it('throws on a non-2xx response, quoting the body', async () => {
    fetchMock.mockResolvedValue(new Response('quota exceeded', { status: 429 }))
    await expect(transcribeAudio(new Blob(['x']), 'audio/mp4', config)).rejects.toThrow(
      /429.*quota exceeded/
    )
  })

  it('throws when the response carries no text', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ text: '   ' }), { status: 200 }))
    await expect(transcribeAudio(new Blob(['x']), 'audio/mp4', config)).rejects.toThrow(/no text/)
  })
})

describe('transcribeAudioOrNull', () => {
  it('resolves to null on failure so the memo just posts without text', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    await expect(transcribeAudioOrNull(new Blob(['x']), 'audio/mp4', config)).resolves.toBeNull()
  })
})

describe('audioExtension', () => {
  it('ignores codec parameters on the MIME type', () => {
    expect(audioExtension('audio/webm;codecs=opus')).toBe('webm')
    expect(audioExtension('audio/mp4')).toBe('m4a')
  })

  it('falls back to webm for anything unrecognized', () => {
    expect(audioExtension('audio/x-weird')).toBe('webm')
  })
})

describe('normalizeEndpoint', () => {
  it('trims whitespace and trailing slashes', () => {
    expect(normalizeEndpoint('  https://host/v1//  ')).toBe('https://host/v1')
  })
})
