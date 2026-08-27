// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  addTranscriptParagraphs,
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
  return fetchMock.mock.calls[0] as [string, RequestInit]
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

  it('runs the paragraph pass on the transcript when one is configured', async () => {
    const spoken = LONG_TRANSCRIPT
    fetchMock.mockImplementation(async (input) => {
      if (String(input).endsWith('/chat/completions')) {
        return new Response(
          JSON.stringify({ choices: [{ message: { content: paragraphed(spoken) } }] }),
          { status: 200 }
        )
      }
      return new Response(JSON.stringify({ text: spoken }), { status: 200 })
    })

    const text = await transcribeAudioOrNull(new Blob(['x']), 'audio/mp4', {
      ...config,
      paragraphModel: 'openai/gpt-oss-20b'
    })

    expect(text).toBe(paragraphed(spoken))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps the raw transcript when the paragraph pass fails', async () => {
    fetchMock.mockImplementation(async (input) => {
      if (String(input).endsWith('/chat/completions')) return new Response('boom', { status: 500 })
      return new Response(JSON.stringify({ text: LONG_TRANSCRIPT }), { status: 200 })
    })

    await expect(
      transcribeAudioOrNull(new Blob(['x']), 'audio/mp4', {
        ...config,
        paragraphModel: 'openai/gpt-oss-20b'
      })
    ).resolves.toBe(LONG_TRANSCRIPT)
  })
})

// Two sentences repeated to clear the length threshold, and the same text with a
// paragraph break added — the only change the pass is permitted to make.
const LONG_TRANSCRIPT =
  `${'The goblin swings and misses. Ezren is still counting his scrolls. '.repeat(6)}`.trim()
const paragraphed = (text: string) => text.replace('. Ezren', '.\n\nEzren')

describe('addTranscriptParagraphs', () => {
  function chatResponse(content: string) {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
    )
  }

  const paragraphConfig = { ...config, paragraphModel: 'openai/gpt-oss-20b' }

  it('posts the transcript to the chat endpoint of the same service', async () => {
    chatResponse(paragraphed(LONG_TRANSCRIPT))
    await addTranscriptParagraphs(LONG_TRANSCRIPT, paragraphConfig)

    const [url, init] = lastRequest()
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    const body = JSON.parse(init.body as string) as {
      model: string
      temperature: number
      messages: Array<{ role: string; content: string }>
    }
    expect(body.model).toBe('openai/gpt-oss-20b')
    expect(body.temperature).toBe(0)
    expect(body.messages[1]).toEqual({ role: 'user', content: LONG_TRANSCRIPT })
  })

  it('keeps the transcript when the model changed the words', async () => {
    // The failure that matters: a transcript is a record of what someone said,
    // so a pass that rewrites it is rejected outright rather than posted.
    chatResponse(LONG_TRANSCRIPT.replace('goblin', 'hobgoblin'))
    await expect(addTranscriptParagraphs(LONG_TRANSCRIPT, paragraphConfig)).rejects.toThrow(
      /changed the words/
    )
  })

  it('keeps the transcript when the model wrapped it in commentary', async () => {
    chatResponse(`Here is the formatted text:\n\n${LONG_TRANSCRIPT}`)
    await expect(addTranscriptParagraphs(LONG_TRANSCRIPT, paragraphConfig)).rejects.toThrow(
      /changed the words/
    )
  })

  it('accepts a reply that only moved whitespace around', async () => {
    chatResponse(paragraphed(LONG_TRANSCRIPT))
    await expect(addTranscriptParagraphs(LONG_TRANSCRIPT, paragraphConfig)).resolves.toBe(
      paragraphed(LONG_TRANSCRIPT)
    )
  })

  it('does not call out at all for a short memo', async () => {
    await expect(addTranscriptParagraphs('Rolling initiative.', paragraphConfig)).resolves.toBe(
      'Rolling initiative.'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not call out when no paragraph model is configured', async () => {
    await expect(addTranscriptParagraphs(LONG_TRANSCRIPT, config)).resolves.toBe(LONG_TRANSCRIPT)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('leaves a transcript that already has paragraphs alone', async () => {
    const already = paragraphed(LONG_TRANSCRIPT)
    await expect(addTranscriptParagraphs(already, paragraphConfig)).resolves.toBe(already)
    expect(fetchMock).not.toHaveBeenCalled()
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
