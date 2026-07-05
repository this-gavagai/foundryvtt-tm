import { describe, it, expect } from 'vitest'
import {
  encodeName,
  decodeName,
  extensionOf,
  fileNameFor,
  remoteFromFileName
} from '@/api/imageCache'

// The cache directory doubles as its own index: filenames must round-trip back
// to the remote URL (or be recognizably hash-named and skipped). These tests
// pin that contract, since a silent break would strand every cached file.

const SHORT_URL = 'https://foundry.example.com/systems/pf2e/icons/spells/fireball.webp'

describe('encodeName/decodeName', () => {
  it('round-trips a typical Foundry asset URL', () => {
    expect(decodeName(encodeName(SHORT_URL))).toBe(SHORT_URL)
  })

  it('round-trips URLs with non-ASCII characters', () => {
    const url = 'https://foundry.example.com/assets/tokens/Škeleton%20König.png'
    expect(decodeName(encodeName(url))).toBe(url)
  })

  it('round-trips URLs with query strings', () => {
    const url = 'https://foundry.example.com/icon.png?v=12&size=large'
    expect(decodeName(encodeName(url))).toBe(url)
  })

  it('produces filename-safe names without dots or padding', () => {
    const encoded = encodeName(SHORT_URL)
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('extensionOf', () => {
  it('extracts the extension from the pathname', () => {
    expect(extensionOf(SHORT_URL)).toBe('.webp')
  })

  it('ignores dots in the query string', () => {
    expect(extensionOf('https://x.example/icon.png?name=a.html')).toBe('.png')
  })

  it('returns empty for extensionless paths and invalid URLs', () => {
    expect(extensionOf('https://x.example/icon')).toBe('')
    expect(extensionOf('not a url')).toBe('')
  })
})

describe('fileNameFor/remoteFromFileName', () => {
  it('uses the decodable encoded name for typical URLs', async () => {
    const name = await fileNameFor(SHORT_URL)
    expect(name).toBe(encodeName(SHORT_URL) + '.webp')
    expect(remoteFromFileName(name)).toBe(SHORT_URL)
  })

  it('falls back to a fixed-size hashed name for very long URLs', async () => {
    const long = 'https://bucket.s3.amazonaws.com/' + 'deep/'.repeat(60) + 'token.png'
    const name = await fileNameFor(long)
    expect(name).toMatch(/^~[0-9a-f]{64}\.png$/)
    expect(name.length).toBeLessThan(255)
    // Hashed names are deliberately not decodable; the index must skip them.
    expect(remoteFromFileName(name)).toBeUndefined()
  })

  it('hashes deterministically', async () => {
    const long = 'https://x.example/' + 'a'.repeat(300) + '.png'
    expect(await fileNameFor(long)).toBe(await fileNameFor(long))
  })

  it('never emits a name over the 255-byte filesystem limit', async () => {
    for (const url of [
      SHORT_URL,
      'https://x.example/' + 'ü'.repeat(120) + '.png',
      'https://x.example/' + 'p'.repeat(500)
    ]) {
      expect((await fileNameFor(url)).length).toBeLessThanOrEqual(255)
    }
  })

  it('handles extensionless filenames when decoding', () => {
    const url = 'https://x.example/icon'
    const encoded = encodeName(url)
    expect(remoteFromFileName(encoded)).toBe(url)
  })

  it('returns undefined for undecodable filenames', () => {
    expect(remoteFromFileName('!!!not-base64url!!!.png')).toBeUndefined()
  })
})
